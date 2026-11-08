"""Where band events come from. The shortcut engine only sees band-shaped packets, whatever the source.

The Mac's gesture source is Runes on a paired iPhone (`PhoneEventSource`). The direct band connection in
bridge.py stays available for development behind RUNES_DIRECT_BAND=1, and feeds the same sink.
"""
import asyncio
import dataclasses
import enum
import json
import os
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class Demand:
    """Which band streams the Mac wants. Motion costs phone battery, so it is requested only when used."""
    active: bool = True
    gyro: bool = False
    orientation: bool = False

    @property
    def motion(self):
        return self.gyro or self.orientation


class EventSink:
    """Receives band-shaped events and link changes. Bridge implements this."""
    def on_event(self, packet):
        raise NotImplementedError

    def on_link(self, link):
        """`link` is {'state', 'phone', 'phones'}; states are unpaired, searching, connected, away, open_app, sleeping."""

    def on_release(self, reason):
        """Release every held key, mouse button and adjustment now."""

    def on_pairing(self, pairing):
        """`pairing` is {'text', 'image', 'expires'} or None when the code is gone."""

    def on_bluetooth(self, state):
        pass

    def on_bindings(self, bindings):
        pass

    def on_log(self, message):
        pass


class EventSource:
    async def run(self, sink):
        raise NotImplementedError

    def set_demand(self, demand):
        pass

    def set_holding(self, holding):
        pass

    def show_pairing(self, show):
        pass

    def forget(self, phone_id=None):
        pass

    def request_status(self):
        pass

    async def close(self):
        pass


_GESTURE_FIELDS = ('finger_code', 'action_code', 'derived_action_code')


def band_packet(message, received_at=None):
    """Turns a helper event into the packet the band transport would have produced."""
    kind = message.get('type')
    sequence, timestamp = message.get('sequence'), message.get('timestamp')
    if not isinstance(sequence, int) or not isinstance(timestamp, int):
        return None
    received_at = time.monotonic() if received_at is None else received_at
    try:
        from meta_neural_py import models
    except ImportError:
        models = None
    if kind == 'Gesture':
        codes = [message.get(name) for name in _GESTURE_FIELDS]
        if not all(isinstance(code, int) and 0 <= code < 256 for code in codes):
            return None
        if models:
            event = models.Gesture(received_at=received_at, source_clock=models.ClockDomain.GESTURE, sequence=sequence,
                                   timestamp=timestamp, finger_code=codes[0], action_code=codes[1],
                                   derived_action_code=codes[2], synthetic=message.get('synthetic') is True)
            return _packet(event)
        return None
    values = message.get('values')
    if kind in ('Gyroscope', 'Orientation') and isinstance(values, list) and len(values) == (3 if kind == 'Gyroscope' else 4) \
            and all(isinstance(v, (int, float)) for v in values):
        if models:
            cls = models.Gyroscope if kind == 'Gyroscope' else models.Orientation
            value = tuple(int(v) for v in values) if kind == 'Gyroscope' else tuple(float(v) for v in values)
            return _packet(cls(received_at=received_at, source_clock=models.ClockDomain.MOTION, sequence=sequence,
                               timestamp=timestamp, values=value))
    return None


def _plain(value):
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    return value


def _packet(event):
    """Same shape as bridge.packet() for these event types."""
    data = {f.name: _plain(getattr(event, f.name)) for f in dataclasses.fields(event)}
    data['type'] = type(event).__name__
    for name in ('finger', 'action', 'derived_action'):
        if hasattr(event, name):
            data[name] = getattr(event, name)
    return data


class PhoneEventSource(EventSource):
    """Runs the native phone-link helper and keeps it running. There is no retry limit:
    the helper only exits on a crash or when the app quits."""

    def __init__(self, executable, state_path=None, restart_delays=(1, 2, 5)):
        self.executable = executable
        self.state_path = state_path
        self.restart_delays = restart_delays
        self.process = None
        self.demand = Demand()
        self.holding = False
        self.pairing = False
        self.closing = False
        self.bindings = []

    def _write(self, command):
        process = self.process
        if process is None or process.stdin is None or process.returncode is not None:
            return
        try:
            process.stdin.write((json.dumps(command) + '\n').encode())
        except (BrokenPipeError, ConnectionResetError, RuntimeError):
            pass

    def set_demand(self, demand):
        self.demand = demand
        self._write({'cmd': 'demand', 'active': demand.active, 'gyro': demand.gyro, 'orientation': demand.orientation})

    def set_holding(self, holding):
        if holding != self.holding:
            self.holding = holding
            self._write({'cmd': 'holding', 'value': holding})

    def show_pairing(self, show):
        self.pairing = show
        self._write({'cmd': 'pairing', 'show': show})

    def forget(self, phone_id=None):
        self._write({'cmd': 'forget', **({'id': phone_id} if phone_id else {})})

    def set_bindings(self, entries):
        self.bindings = entries
        self._write({'cmd': 'bindings', 'entries': entries})

    def request_status(self):
        self._write({'cmd': 'status'})

    async def run(self, sink):
        failures = 0
        while not self.closing:
            if not os.path.exists(self.executable):
                sink.on_log(f'Phone link helper is missing: {self.executable}')
                sink.on_link({'state': 'unavailable', 'phone': None, 'phones': []})
                return
            arguments = [self.executable] + (['--state', self.state_path] if self.state_path else [])
            started = time.monotonic()
            self.process = await asyncio.create_subprocess_exec(*arguments, stdin=asyncio.subprocess.PIPE,
                                                                stdout=asyncio.subprocess.PIPE, limit=1 << 20)
            # Restore what the Mac wants after a helper restart.
            self.set_demand(self.demand)
            if self.holding:
                self._write({'cmd': 'holding', 'value': True})
            if self.pairing:
                self.show_pairing(True)
            if self.bindings:
                self.set_bindings(self.bindings)
            try:
                while line := await self.process.stdout.readline():
                    try:
                        self._dispatch(sink, line)
                    except Exception as exc:
                        # A bad message must never take the link down.
                        sink.on_log(f'Phone link message failed: {type(exc).__name__}: {exc}')
            finally:
                if self.process.returncode is None:
                    try:
                        self.process.kill()
                    except ProcessLookupError:
                        pass
                await self.process.wait()
            if self.closing:
                return
            # A dead helper means no link: nothing may stay held.
            sink.on_release('Phone link restarted')
            failures = 0 if time.monotonic() - started > 60 else failures + 1
            delay = self.restart_delays[min(failures, len(self.restart_delays) - 1)]
            sink.on_log(f'Phone link helper exited ({self.process.returncode}); restarting in {delay} s')
            await asyncio.sleep(delay)

    def _dispatch(self, sink, line):
        try:
            message = json.loads(line)
        except ValueError:
            return
        kind = message.get('kind')
        if kind == 'event':
            packet = band_packet(message)
            if packet is not None:
                sink.on_event(packet)
        elif kind == 'link':
            sink.on_link({'state': message.get('state'), 'phone': message.get('phone'), 'phones': message.get('phones') or []})
        elif kind == 'release':
            sink.on_release(message.get('reason') or 'Phone link')
        elif kind == 'pairing':
            text = message.get('text')
            sink.on_pairing({'text': text, 'image': message.get('image'), 'expires': message.get('expires')} if text else None)
        elif kind == 'bindings':
            entries = message.get('entries')
            sink.on_bindings({'phone': message.get('phone'), 'entries': entries if isinstance(entries, list) else []})
        elif kind == 'bluetooth':
            sink.on_bluetooth(message.get('state'))
        elif kind == 'log':
            sink.on_log(str(message.get('message', ''))[:500])

    async def close(self):
        self.closing = True
        process = self.process
        if process and process.returncode is None:
            self._write({'cmd': 'quit'})
            try:
                await asyncio.wait_for(process.wait(), 2)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()


MOTION_STEPS = ('rotation', 'movement', 'air')
MOTION_ACTIONS = ('mouse-movement', 'adjust', 'radial-menu', 'open-profile-picker')


def demand_for(assignments, viewing_motion=False):
    """Gestures always; gyro and orientation only when an enabled assignment or an open view uses them."""
    motion = viewing_motion
    for assignment in assignments or []:
        if not isinstance(assignment, dict) or assignment.get('enabled') is False:
            continue
        action = assignment.get('appAction')
        if isinstance(action, dict) and (action.get('type') in MOTION_ACTIONS or any(
                isinstance(step, dict) and step.get('type') in MOTION_ACTIONS for step in action.get('actions') or [])):
            motion = True
        ident = assignment.get('id')
        if isinstance(ident, str) and ident.startswith(MOTION_STEPS):
            motion = True
        for step in assignment.get('steps') or []:
            if isinstance(step, dict) and step.get('gesture') in MOTION_STEPS:
                motion = True
    return Demand(active=True, gyro=motion, orientation=motion)
