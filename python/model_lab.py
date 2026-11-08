"""Optional model experiments; no ML dependencies are imported by the band bridge."""
import asyncio
import json
import os
from pathlib import Path
import signal
import sys
import time

MODELS = ('handwriting', 'pose')


class ModelLab:
    def __init__(self, emit, root=None):
        self.emit = emit
        self.root = Path(root or os.environ.get('RUNES_MODEL_HOME', Path.home() / 'Library/Application Support/Runes/model-lab'))
        self.job = None
        self.process = None
        self.active = None
        self.capture = None
        self.recording = None
        self.timer = None
        self.states = {model: {'phase': 'idle', 'message': 'Not installed'} for model in MODELS}

    def status(self, model=None, **update):
        if model:
            self.states[model].update(update)
        for key in ([model] if model else MODELS):
            installed = (self.root / key / 'ready.json').is_file() and (self.root / 'runtime/bin/python').is_file()
            if installed and self.states[key]['phase'] == 'idle' and self.states[key]['message'] == 'Not installed':
                self.states[key]['message'] = 'Installed. Ready to record.'
            self.emit('model_status', model=key, installed=installed, **self.states[key])

    async def command(self, command, connected=False):
        action = command['action']
        model = command.get('model')
        if action == 'model_status':
            self.status()
            return
        if action == 'model_leave':
            if self.capture or (self.active and self.states[self.active]['phase'] != 'installing'):
                await self.cancel()
            else:
                self.recording = None
                (self.root / 'capture.json').unlink(missing_ok=True)
                for key in MODELS:
                    self.status(key, samples=0)
            return
        if action == 'model_cancel':
            await self.cancel()
            return
        if model not in MODELS:
            raise ValueError('Unknown model experiment')
        if action == 'model_capture_start':
            if not connected:
                raise ValueError('Connect a real band before capturing EMG')
            if self.active or self.capture:
                raise ValueError('Finish the current model operation first')
            self.recording = None
            (self.root / 'capture.json').unlink(missing_ok=True)
            for key in MODELS:
                self.status(key, samples=0)
            self.capture = {'model': model, 'rows': [], 'last_timestamp': None, 'started': time.monotonic()}
            self.status(model, phase='capturing', message='Recording eight-channel EMG for up to 12 seconds', samples=0, result=None)
            self.timer = asyncio.get_running_loop().call_later(12, self.finish_capture)
        elif action == 'model_capture_stop':
            self.finish_capture()
        elif action in ('model_install', 'model_run'):
            if self.active or self.capture:
                raise ValueError('Finish the current model operation first')
            if action == 'model_run':
                if not self.recording:
                    raise ValueError('Record a clean EMG sample first')
                if model == 'handwriting' and command.get('mapping') == 'repeat':
                    raise ValueError('Repeated channels make handwriting features singular. Use interpolation for this baseline.')
                if command.get('mapping') not in ('repeat', 'interpolate'):
                    raise ValueError('Choose an experimental channel mapping')
                if not (self.root / model / 'ready.json').is_file():
                    raise ValueError('Install this model first')
            self.active = model
            self.job = asyncio.create_task(self.run_job(model, command))

    def ingest(self, packet):
        capture = self.capture
        if not capture:
            return
        kind = packet.get('type')
        if kind in ('Discontinuity', 'ConnectionState'):
            self.invalidate('Recording discarded because the sensor stream was interrupted')
            return
        if kind != 'EMGBatch':
            return
        rows = packet.get('values', [])
        if not rows or any(len(row) != 8 or any(type(v) is not int or not 0 <= v <= 65535 for v in row) for row in rows):
            self.invalidate('Recording discarded: unexpected EMG format')
            return
        now = time.monotonic()
        timestamp = packet.get('timestamp')
        last = capture['last_timestamp']
        # Device timestamps are microseconds. Sequence counters alone do not detect all loss.
        if last is not None and isinstance(timestamp, (int, float)):
            expected = capture.get('last_count', 16) / 2048 * 1e6
            if abs(timestamp - last - expected) > 1500:
                self.invalidate('Recording discarded: EMG device timestamps contain a gap or overlap')
                return
        if now - capture.get('last_received', now) > .5:
            self.invalidate('Recording discarded: EMG delivery stalled')
            return
        capture.update(last_timestamp=timestamp, last_count=len(rows), last_received=now)
        capture['rows'].extend(rows)
        if len(capture['rows']) >= 24576:
            self.finish_capture()
        elif now - capture.get('last_update', 0) >= .25:
            capture['last_update'] = now
            self.status(capture['model'], samples=len(capture['rows']))

    def invalidate(self, message):
        if self.capture:
            model = self.capture['model']
            self.capture = None
            self.recording = None
            if self.timer:
                self.timer.cancel()
            self.status(model, phase='error', message=message, samples=0)

    def finish_capture(self):
        if not self.capture:
            return
        if self.timer:
            self.timer.cancel()
        capture, self.capture = self.capture, None
        count = len(capture['rows'])
        if count < 2048 * 3:
            self.recording = None
            self.status(capture['model'], phase='error', message='Record at least three seconds of uninterrupted EMG', samples=count)
            return
        try:
            self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
            target = self.root / 'capture.json'
            # Create private from the first byte, even under a permissive umask.
            with open(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as output:
                json.dump({'sample_rate': 2048, 'channels': 8, 'rows': capture['rows']}, output)
            self.recording = target
        except OSError as exc:
            self.recording = None
            self.status(capture['model'], phase='error', message=f'Could not save temporary recording: {exc}', samples=0)
            return
        self.status(capture['model'], phase='captured', message=f'Recorded {count / 2048:.1f} seconds. Ready to run.', samples=count)

    async def run_job(self, model, command):
        try:
            installing = command['action'] == 'model_install'
            phase = 'installing' if installing else 'running'
            self.status(model, phase=phase, message='Preparing optional runtime…' if installing else 'Loading model and decoding your recording…')
            script = Path(__file__).with_name('model_runtime.py')
            executable = sys.executable if installing else str(self.root / 'runtime/bin/python')
            args = [executable, '-u', str(script), 'install' if installing else 'infer', '--root', str(self.root), '--model', model]
            if not installing:
                args += ['--capture', str(self.recording), '--mapping', command['mapping']]
            env = dict(os.environ, PYTHONUNBUFFERED='1', PYTHONNOUSERSITE='1', PYTHONDONTWRITEBYTECODE='1')
            if not installing:
                env.pop('PYTHONHOME', None)
            self.process = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env=env, start_new_session=True, limit=1024*1024)
            last = ''
            got_result = False
            async for line in self.process.stdout:
                text = line.decode(errors='replace').strip()
                if not text:
                    continue
                last = text[-2000:]
                try:
                    message = json.loads(text)
                except ValueError:
                    self.status(model, message=text[-2000:])
                    continue
                if message.get('event') == 'result':
                    got_result = True
                    self.states[model]['result'] = message['result']
                    self.emit('model_result', model=model, result=message['result'])
                else:
                    self.status(model, message=message.get('message', text))
            code = await self.process.wait()
            if code:
                raise RuntimeError(last or f'Model process exited with code {code}')
            if not installing and not got_result:
                raise RuntimeError('Model process exited without returning a result')
            self.status(model, phase='ready', message='Installed and verified on CPU' if installing else 'Inference complete. Experimental mapping; accuracy is unvalidated.')
        except asyncio.CancelledError:
            self.status(model, phase='idle', message='Operation cancelled. You can retry.')
            raise
        except Exception as exc:
            self.status(model, phase='error', message=str(exc)[-2000:])
        finally:
            if self.process and self.process.returncode is None:
                try:
                    os.killpg(self.process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    await asyncio.wait_for(self.process.wait(), 3)
                except asyncio.TimeoutError:
                    os.killpg(self.process.pid, signal.SIGKILL)
                    await self.process.wait()
            self.process = None
            self.active = None

    async def cancel(self):
        if self.capture:
            model = self.capture['model']
            self.invalidate('Recording cancelled')
            self.status(model, phase='idle', message='Recording cancelled')
        if self.job and not self.job.done():
            self.job.cancel()
            try:
                await self.job
            except asyncio.CancelledError:
                pass
        self.active = None
        # Raw recordings are temporary, never kept on exit.
        self.recording = None
        for key in MODELS:
            self.status(key, samples=0)
        (self.root / 'capture.json').unlink(missing_ok=True)
