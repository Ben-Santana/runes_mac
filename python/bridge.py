"""Line-delimited JSON transport. Stdout contains protocol messages only."""
import asyncio
import dataclasses
import enum
import json
import math
import sys
import time
import threading
import uuid
import urllib.error
try:
    from .model_lab import ModelLab
    from .native_handwriting import NativeHandwriting
except ImportError:
    try:
        from model_lab import ModelLab
        from native_handwriting import NativeHandwriting
    except ImportError:
        from python.model_lab import ModelLab
        from python.native_handwriting import NativeHandwriting
if __package__:
    from .mouse import release_hold
    from .macos_actions import execute_macos_action
    from .api_calls import execute_api_call
    from .shortcuts import MacKeyboard, ShortcutEngine, valid_app_action
else:
    try:
        from mouse import release_hold
        from macos_actions import execute_macos_action
        from api_calls import execute_api_call
        from shortcuts import MacKeyboard, ShortcutEngine, valid_app_action
    except ModuleNotFoundError:
        from python.mouse import release_hold
        from python.macos_actions import execute_macos_action
        from python.api_calls import execute_api_call
        from python.shortcuts import MacKeyboard, ShortcutEngine, valid_app_action


try:
    from .event_sources import Demand, EventSink, PhoneEventSource, demand_for
except ImportError:
    try:
        from event_sources import Demand, EventSink, PhoneEventSource, demand_for
    except ImportError:
        from python.event_sources import Demand, EventSink, PhoneEventSource, demand_for
try:
    from .mouse import holding as mouse_holding
except ImportError:
    try:
        from mouse import holding as mouse_holding
    except ImportError:
        from python.mouse import holding as mouse_holding


# The Mac never connects to the band unless a developer opts in. Its gesture source is Neural on iPhone.
DIRECT_BAND = __import__('os').environ.get('NEURAL_DIRECT_BAND') == '1'
DIRECT_BAND_ACTIONS = ('discover', 'identities', 'connect', 'enroll', 'disconnect')

try:
    from .connection_identity import ConnectionIdentityStore, identity_catalog
except ImportError:
    try:
        from connection_identity import ConnectionIdentityStore, identity_catalog
    except ImportError:
        from python.connection_identity import ConnectionIdentityStore, identity_catalog


def normalize(value):
    if dataclasses.is_dataclass(value):
        return {f.name: normalize(getattr(value, f.name)) for f in dataclasses.fields(value)}
    if isinstance(value, bytes):
        return {"encoding": "hex", "data": value.hex()}
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, dict):
        return {str(k): normalize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalize(v) for v in value]
    return value


def packet(event):
    data = normalize(event)
    data['type'] = type(event).__name__
    for name in ('finger', 'action', 'derived_action'):
        if hasattr(event, name):
            data[name] = getattr(event, name)
    return data


def emit(kind, **data):
    print(json.dumps({"kind": kind, **data}), flush=True)


def discovery_timeout(value):
    """Keep background scans short without letting a bad command hang or return immediately."""
    if value is None:
        return 5
    try:
        timeout = float(value)
    except (TypeError, ValueError):
        return 5
    if not math.isfinite(timeout) or timeout <= 0:
        return 5
    timeout = min(8.0, max(1.0, timeout))
    return int(timeout) if timeout.is_integer() else timeout


class Bridge(EventSink):
    def __init__(self):
        self.models = ModelLab(emit)
        self.native = NativeHandwriting(emit, self.models.root)
        self.login_requests = {}
        self.session = None
        self.pending = []
        self.band = None
        self.keyboard = MacKeyboard()
        self.shortcut_error = None
        self.api_slots = threading.BoundedSemaphore(4)
        self.source = None
        self.source_task = None
        self.link = {'state': 'starting', 'phone': None, 'phones': []}
        self.pairing = None
        self.bluetooth = None
        self.assignments = []
        self.viewing_motion = False
        self.last_flush = 0.0
        self.flush_handle = None
        self.shortcuts = ShortcutEngine(self.deliver_shortcut, on_recognized=lambda motion: emit('motion', motion=motion), on_progress=lambda candidates: emit('combo_progress', candidates=candidates), on_input=lambda event: emit('gesture_input', input=event), on_outcome=lambda outcome: emit('combo_outcome', **outcome), on_action=lambda: emit('action_fired'), on_adjust=lambda: emit('adjust_tick'), on_air_preview=lambda state: emit('air_preview', **state), on_air_result=lambda state: emit('air_result', **state))

    # Event sink. Every source feeds this path, so shortcuts, combos, profiles and hold-and-turn don't care where events come from.

    def handle_event(self, data):
        self.models.ingest(data)
        self.shortcuts.ingest(data)
        self.pending.append(data)
        self.update_holding()

    def is_holding(self):
        engine = self.shortcuts
        return bool(engine.held_fingers) or engine.adjustment is not None or engine.mouse is not None or mouse_holding()

    def update_holding(self):
        if self.source:
            self.source.set_holding(self.is_holding())

    def release_all(self, reason=''):
        """Nothing may stay held once the link drops or goes stale."""
        self.release_mouse_hold()
        self.shortcuts.reset()
        self.update_holding()

    def on_event(self, packet):
        if self.link.get('state') != 'connected':
            return
        self.handle_event(packet)
        now = time.monotonic()
        if now - self.last_flush >= 1/30:
            self.flush_events()
        elif self.flush_handle is None:
            self.flush_handle = asyncio.get_running_loop().call_later(1/30, self.flush_events)

    def flush_events(self):
        self.flush_handle = None
        self.last_flush = time.monotonic()
        if self.pending:
            emit('events', events=self.pending)
            self.pending = []

    def on_link(self, link):
        previous = self.link.get('state')
        self.link = link
        if link.get('state') != 'connected':
            self.release_all('link ' + str(link.get('state')))
            if previous == 'connected':
                self.models.invalidate('Recording discarded: iPhone disconnected')
        emit('phone_link', **link)
        emit('state', state='connected' if link.get('state') == 'connected' else 'disconnected')

    def on_release(self, reason):
        self.release_all(reason)

    def on_pairing(self, pairing):
        self.pairing = pairing
        emit('phone_pairing', **(pairing or {'text': None}))

    def on_bluetooth(self, state):
        self.bluetooth = state
        emit('phone_bluetooth', state=state)

    def on_log(self, message):
        print(message, file=sys.stderr, flush=True)

    def update_demand(self):
        if self.source:
            self.source.set_demand(demand_for(self.assignments, self.viewing_motion))

    def start_source(self):
        import os
        executable = os.environ.get('NEURAL_PHONE_LINK') or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'dist-electron', 'neural-phone-link')
        self.source = PhoneEventSource(executable, os.environ.get('NEURAL_PHONE_LINK_STATE'))
        self.update_demand()
        self.source_task = asyncio.create_task(self.source.run(self))

    async def stop_source(self):
        if self.source:
            await self.source.close()
        if self.source_task:
            self.source_task.cancel()
            try:
                await self.source_task
            except (asyncio.CancelledError, Exception):
                pass
        self.release_all('shutdown')

    def release_mouse_hold(self):
        try:
            release_hold()
        except Exception as exc:
            emit('error', message=str(exc))

    def deliver_shortcut(self, shortcut):
        if self.native.active or self.models.capture or (self.models.active and self.models.states[self.models.active]['phase'] == 'running'):
            return False
        if 'mouseMove' in shortcut:
            try:
                try:
                    from .mouse import pointer
                except ImportError:
                    from mouse import pointer
                pointer(**shortcut['mouseMove'])
                self.shortcut_error = None
                return True
            except Exception as exc:
                if str(exc) != self.shortcut_error:
                    emit('error', message=str(exc))
                self.shortcut_error = str(exc)
                self.shortcuts.mouse = None
                return False
        if 'appAction' in shortcut:
            if shortcut['appAction'].get('type') == 'sequence':
                if not valid_app_action(shortcut['appAction']):
                    return False
                if self.api_slots.acquire(blocking=False):
                    threading.Thread(target=self.deliver_sequence, args=(shortcut['appAction'],), daemon=True).start()
                    return True
                emit('error', message='Action sequence skipped: four actions are already running.')
                return False
            if shortcut['appAction'].get('type') == 'macos-action':
                if shortcut['appAction'].get('action') in ('click-hold', 'volume-up', 'volume-down', 'mute', 'brightness-up', 'brightness-down'):
                    try:
                        execute_macos_action(shortcut['appAction'])
                        return True
                    except Exception as exc:
                        emit('error', message=str(exc))
                        return False
                if self.api_slots.acquire(blocking=False):
                    threading.Thread(target=self.deliver_macos_action, args=(shortcut['appAction'],), daemon=True).start()
                    return True
                emit('error', message='macOS action skipped: four actions are already running.')
                return False
            if shortcut['appAction'].get('type') == 'type-text':
                if not valid_app_action(shortcut['appAction']):
                    return False
                if self.api_slots.acquire(blocking=False):
                    threading.Thread(target=self.deliver_text, args=(shortcut['appAction'],), daemon=True).start()
                    return True
                emit('error', message='Text action skipped: four actions are already running.')
                return False
            if shortcut['appAction'].get('type') == 'api-call':
                if self.api_slots.acquire(blocking=False):
                    threading.Thread(target=self.deliver_api_call, args=(shortcut['appAction'],), daemon=True).start()
                    return True
                emit('api_result', ok=False, message='API call skipped: four requests are already running.')
                return False
            if shortcut['appAction'].get('type') in ('open-profile-picker', 'radial-menu'):
                self.shortcuts.picker_open = True
            emit('app_action', action=shortcut['appAction'])
            return True
        try:
            self.keyboard.send(shortcut)
            self.shortcut_error = None
            return True
        except Exception as exc:
            # Delivery failure must not stop recognition or its visual feedback.
            message = str(exc)
            if message != self.shortcut_error:
                emit('error', message=message)
            self.shortcut_error = message
            return False

    def deliver_sequence(self, action):
        try:
            for step in action['actions']:
                kind = step['type']
                if kind == 'shortcut':
                    self.keyboard.send(step['shortcut'])
                elif kind == 'macos-action':
                    execute_macos_action(step)
                elif kind == 'type-text':
                    self.keyboard.type_text(step['text'])
                elif kind == 'api-call':
                    status = execute_api_call(step)
                    emit('api_result', ok=True, status=status)
                else:
                    emit('app_action', action=step)
                # Give the target app time to process each completed step.
                time.sleep(.1)
        except Exception:
            emit('error', message='Action sequence stopped because an action failed. Check its configuration and macOS permissions.')
        finally:
            self.api_slots.release()

    def deliver_text(self, action):
        try:
            self.keyboard.type_text(action['text'])
        except Exception:
            emit('error', message='Text action failed. Check macOS Accessibility permissions.')
        finally:
            self.api_slots.release()

    def deliver_macos_action(self, action):
        try:
            execute_macos_action(action)
        except Exception:
            emit('error', message='macOS action failed. Check the app name and macOS Accessibility / Automation permissions.')
        finally:
            self.api_slots.release()

    def deliver_api_call(self, action):
        try:
            status = execute_api_call(action)
            emit('api_result', ok=True, status=status)
        except urllib.error.HTTPError as exc:
            emit('api_result', ok=False, message=f'API call returned HTTP {exc.code}.')
            exc.close()
        except Exception:
            # Do not expose tokens, URLs, or response bodies in diagnostics.
            emit('api_result', ok=False, message='API call failed. Check the endpoint, connection, and timeout.')
        finally:
            self.api_slots.release()

    async def disconnect(self):
        clean = True
        try:
            await self.native.stop()
        except Exception as exc:
            clean = False
            emit('error', message=f'Native stream cleanup failed: {type(exc).__name__}')
        self.release_mouse_hold()
        self.shortcuts.reset()
        if self.session:
            session = self.session
            session.cancel()
            try:
                await session
            except asyncio.CancelledError:
                pass
            except Exception as exc:
                # A failed cleanup must not make every later Connect re-raise
                # the same completed session's exception.
                clean = False
                emit('error', message=f'Previous connection closed: {type(exc).__name__}: {exc}')
            finally:
                self.session = None
        return clean

    retry_delays = (1, 2, 4)

    @staticmethod
    def recovery(error):
        from meta_neural_py.errors import (IdentityMismatch, IdentityStoreError, RequestTimeout,
                                          DeviceDisconnected, PermissionDenied, LoginCancelled)
        if isinstance(error, LoginCancelled):
            return 'cancelled', False, 'Meta sign-in canceled. Automatic connection is paused. Your saved identities were retained.'
        if isinstance(error, IdentityStoreError):
            return 'identity', False, 'The selected identity could not be read. Unlock Keychain or choose another saved identity. Enrollment has not started.'
        if isinstance(error, IdentityMismatch):
            return 'identity', False, 'The selected identity is missing or was rejected. Check the public fingerprint and saved identity selection. Enrollment has not started.'
        if isinstance(error, RequestTimeout) and error.stage == 'trust':
            return 'authentication', False, 'Host authentication timed out. Release the other client and retry the same identity. Enrollment has not started.'
        if isinstance(error, PermissionDenied):
            return 'permission', False, 'Allow Bluetooth access in System Settings, then reconnect.'
        if isinstance(error, (DeviceDisconnected, OSError, RequestTimeout)):
            return 'transport', True, 'Bluetooth or the data channel is unavailable. Release the other client, check pairing, or rediscover the band.'
        return 'protocol', False, 'Connection setup failed. Inspect the diagnostic, then retry or choose an existing identity. Enrollment has not started.'

    async def enroll(self, device_id, allow_missing_band_key=None):
        from meta_neural_py import Band
        emit('state', state='enrolling')
        try:
            if allow_missing_band_key is None:
                # Missing band keys are normal for the supported ownership service.
                allow_missing_band_key = True
            from meta_neural_py.identity.meta_auth import MetaAuth
            bridge = self
            class LoginProvider:
                async def open(self, url):
                    request_id = uuid.uuid4().hex
                    future = asyncio.get_running_loop().create_future()
                    bridge.login_requests[request_id] = future
                    emit('meta_login', request_id=request_id, url=url)
                    try:
                        return await future
                    finally:
                        bridge.login_requests.pop(request_id, None)
                        emit('meta_login_cancel', request_id=request_id)
            from meta_neural_py.identity.trust import public_point
            identity_store = ConnectionIdentityStore(device_id)
            saved = await asyncio.to_thread(identity_store.store.load, identity_store.account)
            known_point = public_point(saved.band_public_key) if saved is not None and saved.band_public_key is not None else None
            await Band.enroll(device_id, auth=MetaAuth(login=LoginProvider()), identity_store=identity_store,
                              band_public_key=known_point, allow_missing_band_key=allow_missing_band_key)
            await asyncio.to_thread(identity_store.authenticated)
            emit('enrolled', device_id=device_id)
        except asyncio.CancelledError:
            emit('state', state='disconnected')
            raise
        except Exception as exc:
            category, _, message = self.recovery(exc)
            emit('connection_recovery', device_id=device_id, category=category, message=message, detail=f'{type(exc).__name__}: {exc}')
            emit('state', state='disconnected')
            return
        await self.stream(device_id)

    async def stream(self, device_id, quiet=False, identity_account=None, pending=False):
        try:
            for attempt in range(len(self.retry_delays) + 1):
                try:
                    await self._stream_once(device_id, identity_account=identity_account, pending=pending)
                    return
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    category, retryable, message = self.recovery(exc)
                    if retryable and attempt < len(self.retry_delays):
                        delay = self.retry_delays[attempt]
                        emit('state', state='reconnecting', attempt=attempt + 1, delay=delay)
                        emit('connection_progress', message=f'{message} Retrying in {delay} seconds ({attempt + 1}/{len(self.retry_delays)}).')
                        await asyncio.sleep(delay)
                        continue
                    emit('connection_recovery', device_id=device_id, category=category, message=message + ' Automatic connection is paused.', detail=f'{type(exc).__name__}: {exc}')
                    return
        finally:
            emit('state', state='disconnected')

    async def _stream_once(self, device_id, identity_account=None, pending=False):
        try:
            from meta_neural_py import Band, Streams
            from meta_neural_py.protocol.protobuf import field
            emit('state', state='connecting')
            identity_store = ConnectionIdentityStore(device_id, identity_account, pending)
            async with Band(device_id, identity_store=identity_store) as band:
                await asyncio.to_thread(identity_store.authenticated)
                # The account and public fingerprint can be inspected through the catalog.
                emit('identity_selected', account=identity_store.account, pending=pending)
                self.band = band
                emit('device', info=normalize(band.device_info), verified=band.band_verified,
                     hand=await band.read_hand(), battery=normalize(await band.read_battery()))
                # Request active device state before enabling gesture/sensor streams.
                await band._rpc('request_active', 6, 5, field(6, 2))
                async with band.subscribe(Streams(gestures=True, gyro=True, orientation=True, emg=True)) as events:
                    await self.native.attach(band)
                    emit('state', state='connected')
                    last_flush = time.monotonic()
                    last_battery = last_flush
                    async for event in events:
                        self.handle_event(packet(event))
                        now = time.monotonic()
                        if now-last_flush >= 1/30:
                            emit('events', events=self.pending, stats=normalize(band.stats))
                            self.pending = []
                            last_flush = now
                        if now-last_battery >= 30:
                            emit('battery', battery=normalize(await band.read_battery()))
                            last_battery = now
        finally:
            if self.pending:
                emit('events', events=self.pending)
                self.pending = []
            self.release_mouse_hold()
            try:
                await self.native.stop()
            finally:
                try:
                    self.native.detach()
                    self.models.invalidate('Recording discarded: band disconnected')
                finally:
                    self.band = None

    async def command(self, command):
        action = command.get('action')
        if action in DIRECT_BAND_ACTIONS and not DIRECT_BAND:
            # The Mac must never connect to the band directly; gestures come from iPhone.
            return True
        if action == 'phone_status':
            emit('phone_link', **self.link)
            emit('phone_pairing', **(self.pairing or {'text': None}))
            if self.bluetooth:
                emit('phone_bluetooth', state=self.bluetooth)
            if self.source:
                self.source.request_status()
        elif action == 'phone_pair':
            if self.source:
                self.source.show_pairing(command.get('show') is not False)
        elif action == 'phone_forget':
            if self.source:
                phone_id = command.get('id')
                self.source.forget(phone_id if isinstance(phone_id, str) else None)
        elif action == 'motion_view':
            self.viewing_motion = command.get('enabled') is True
            self.update_demand()
        elif isinstance(action, str) and action.startswith('native_handwriting_'):
            try:
                if action == 'native_handwriting_start':
                    if self.models.capture or self.models.active:
                        raise ValueError('Finish the research experiment first')
                    self.release_mouse_hold()
                    self.shortcuts.reset()
                    await self.native.start()
                elif action == 'native_handwriting_stop':
                    await self.native.stop()
                elif action == 'native_handwriting_clear':
                    self.native.clear()
                elif action == 'native_handwriting_status':
                    self.native.status()
            except Exception as exc:
                self.native.status(message=str(exc))
        elif isinstance(action, str) and action.startswith('model_'):
            try:
                if action == 'model_leave':
                    await self.native.stop()
                elif action in ('model_capture_start', 'model_run', 'model_install') and self.native.active:
                    raise ValueError('Stop native handwriting and wait for settings restoration first')
                await self.models.command(command, connected=self.band is not None)
            except Exception as exc:
                emit('model_error', model=command.get('model'), message=str(exc))
        elif action == 'meta_login_result':
            future = self.login_requests.get(command.get('request_id'))
            if future and not future.done():
                if command.get('callback'):
                    future.set_result(command['callback'])
                else:
                    from meta_neural_py.errors import LoginCancelled
                    future.set_exception(LoginCancelled('Meta sign-in cancelled'))
        elif action == 'air_preview':
            self.shortcuts.air_preview_enabled = command.get('enabled') is True
            self.shortcuts.publish_air_preview()
        elif action == 'configure_shortcuts':
            self.release_mouse_hold()
            self.assignments = command.get('assignments', []) if isinstance(command.get('assignments'), list) else []
            self.shortcuts.configure(command.get('assignments', []))
            self.update_holding()
            self.update_demand()
        elif action == 'radial_execute':
            output = command.get('output')
            if isinstance(output, dict) and output.get('type') == 'shortcut':
                output = output.get('shortcut')
            if isinstance(output, dict) and valid_app_action(output) and output.get('type') not in ('radial-menu', 'adjust', 'mouse-movement'):
                if self.deliver_shortcut({'appAction': output}):
                    emit('action_fired')
            else:
                try:
                    from .shortcuts import valid_shortcut
                except ImportError:
                    from shortcuts import valid_shortcut
                if valid_shortcut(output) and self.deliver_shortcut(output):
                    emit('action_fired')
        elif action == 'profile_picker':
            self.shortcuts.picker_open = command.get('open') is True
            self.shortcuts.reset()
        elif action == 'suspend_shortcuts':
            self.release_mouse_hold()
            self.shortcuts.suspended = command.get('suspended') is not False
            self.shortcuts.reset()
        elif action == 'discover':
            from meta_neural_py import Band
            request_id = command.get('request_id')
            # A scan during an open connection stalls the bridge and can disturb the band.
            if self.band is not None or (self.session and not self.session.done()):
                emit('devices', devices=[], request_id=request_id)
            else:
                quiet = command.get('quiet') is True or (isinstance(request_id, str) and request_id.startswith('watch:'))
                try:
                    devices = normalize(await Band.discover(timeout=discovery_timeout(command.get('timeout'))))
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    devices = []
                    from meta_neural_py.errors import PermissionDenied, UnsupportedPlatform
                    if isinstance(exc, (PermissionDenied, UnsupportedPlatform)):
                        emit('connection_recovery', category='permission', message='Bluetooth discovery needs user intervention. Check Bluetooth permissions and platform support, then Scan again.', detail=f'{type(exc).__name__}: {exc}')
                    elif not quiet:
                        emit('error', message=f'{type(exc).__name__}: {exc}')
                emit('devices', devices=devices, request_id=request_id)
        elif action == 'identities':
            try:
                emit('identities', identities=await asyncio.to_thread(identity_catalog))
            except Exception as exc:
                emit('identity_catalog_error', message=f'Cannot inspect saved identities: {exc}')
        elif action == 'connect':
            await self.disconnect()
            self.session = asyncio.create_task(self.stream(command['device_id'], quiet=command.get('quiet') is True, identity_account=command.get('identity_account'), pending=command.get('pending') is True))
        elif action == 'enroll':
            await self.disconnect()
            self.session = asyncio.create_task(self.enroll(command['device_id'], command.get('allow_missing_band_key')))
        elif action == 'disconnect':
            emit('state', state='disconnecting')
            clean = await self.disconnect()
            emit('state', state='disconnected')
            if clean:
                emit('handoff_ready', message='Local connection closed and automatic connection paused. Connect on iPhone to confirm Bluetooth availability.')
            else:
                emit('handoff_unconfirmed', message='Local cleanup reported an error. Automatic connection is paused. Check diagnostics and retry Disconnect before using iPhone; do not re-enroll.')
        elif action == 'shutdown':
            await self.models.cancel()
            await self.stop_source()
            await self.disconnect()
            return False
        return True


async def main():
    bridge = Bridge()
    emit('ready')
    if not DIRECT_BAND:
        bridge.start_source()
    try:
        while line := await asyncio.to_thread(sys.stdin.readline):
            try:
                if not await bridge.command(json.loads(line)):
                    break
            except Exception as exc:
                emit('error', message=f'{type(exc).__name__}: {exc}')
    finally:
        await bridge.models.cancel()
        await bridge.stop_source()
        await bridge.disconnect()


if __name__ == '__main__':
    asyncio.run(main())
