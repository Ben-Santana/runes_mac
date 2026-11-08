import asyncio
import importlib.util
import json
import os
import pathlib
import stat
import sys
import tempfile
import textwrap
import unittest
from unittest.mock import patch

root = pathlib.Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location('bridge', root/'python/bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
sys.path.insert(0, str(root/'python'))
import event_sources  # noqa: E402

BUTTON_HOLD, BUTTON_RELEASE, INDEX = 3, 4, 2


def gesture(action, derived, sequence=1):
    return {'kind': 'event', 'type': 'Gesture', 'sequence': sequence, 'timestamp': 10, 'finger_code': INDEX,
            'action_code': action, 'derived_action_code': derived, 'synthetic': False, 'age_ms': 4}


class PacketTests(unittest.TestCase):
    def test_phone_gesture_matches_band_packet(self):
        from meta_neural_py import Gesture, ClockDomain
        relayed = event_sources.band_packet(gesture(3, 1), received_at=5.0)
        band = bridge.packet(Gesture(received_at=5.0, source_clock=ClockDomain.GESTURE, sequence=1, timestamp=10,
                                     finger_code=INDEX, action_code=3, derived_action_code=1, synthetic=False))
        self.assertEqual(relayed, band)
        self.assertEqual((relayed['type'], relayed['finger'], relayed['derived_action']), ('Gesture', 'index', 'singleTap'))

    def test_phone_motion_matches_band_packet(self):
        from meta_neural_py import Gyroscope, Orientation, ClockDomain
        gyro = event_sources.band_packet({'type': 'Gyroscope', 'sequence': 2, 'timestamp': 3, 'values': [1, -2, 3]}, received_at=1.0)
        self.assertEqual(gyro, bridge.packet(Gyroscope(received_at=1.0, source_clock=ClockDomain.MOTION, sequence=2, timestamp=3, values=(1, -2, 3))))
        q = event_sources.band_packet({'type': 'Orientation', 'sequence': 2, 'timestamp': 3, 'values': [1, 0, 0, 0]}, received_at=1.0)
        self.assertEqual(q, bridge.packet(Orientation(received_at=1.0, source_clock=ClockDomain.MOTION, sequence=2, timestamp=3, values=(1.0, 0.0, 0.0, 0.0))))

    def test_malformed_events_are_dropped(self):
        for message in ({'type': 'Gesture', 'sequence': 1, 'timestamp': 1, 'finger_code': 300, 'action_code': 1, 'derived_action_code': 1},
                        {'type': 'Gesture', 'sequence': 'x', 'timestamp': 1},
                        {'type': 'Gyroscope', 'sequence': 1, 'timestamp': 1, 'values': [1, 2]},
                        {'type': 'EMG', 'sequence': 1, 'timestamp': 1}):
            self.assertIsNone(event_sources.band_packet(message))


class DemandTests(unittest.TestCase):
    def test_gestures_only_by_default(self):
        self.assertEqual(event_sources.demand_for([{'id': 'tap-index', 'enabled': True, 'shortcut': {}}]), event_sources.Demand())

    def test_motion_when_used(self):
        cases = [
            [{'id': 'hold-index', 'enabled': True, 'appAction': {'type': 'adjust'}}],
            [{'id': 'tap-middle', 'enabled': True, 'appAction': {'type': 'mouse-movement'}}],
            [{'id': 'combo-1', 'enabled': True, 'steps': [{'gesture': 'tap-index'}, {'gesture': 'air'}]}],
            [{'id': 'rotation-x-left', 'enabled': True}],
        ]
        for assignments in cases:
            self.assertTrue(event_sources.demand_for(assignments).motion, assignments)
        self.assertFalse(event_sources.demand_for([{'id': 'hold-index', 'enabled': False, 'appAction': {'type': 'adjust'}}]).motion)
        self.assertTrue(event_sources.demand_for([], viewing_motion=True).motion)


FAKE_HELPER = '''
import json, sys, time
log = open({log!r}, 'a')
def out(message):
    print(json.dumps(message), flush=True)
out({{'kind': 'link', 'state': 'connected', 'phone': 'Test iPhone', 'phones': []}})
script = json.loads({script!r})
for item in script:
    if item == 'wait':
        line = sys.stdin.readline()
        log.write(line); log.flush()
        continue
    out(item)
    time.sleep(0.02)
for line in sys.stdin:
    log.write(line); log.flush()
    if 'quit' in line:
        break
'''


class PhoneSourceTests(unittest.IsolatedAsyncioTestCase):
    def helper(self, script):
        folder = tempfile.mkdtemp()
        log = os.path.join(folder, 'commands.log')
        path = os.path.join(folder, 'helper')
        with open(path, 'w') as f:
            f.write('#!' + sys.executable + '\n' + FAKE_HELPER.format(log=log, script=json.dumps(script)))
        os.chmod(path, os.stat(path).st_mode | stat.S_IEXEC)
        return path, log

    def commands(self, log):
        with open(log) as f:
            return [json.loads(line) for line in f if line.strip()]

    async def run_source(self, worker, path, until):
        worker.source = event_sources.PhoneEventSource(path, restart_delays=(30,))
        worker.update_demand()
        task = asyncio.create_task(worker.source.run(worker))
        for _ in range(200):
            if until():
                break
            await asyncio.sleep(0.01)
        await worker.source.close()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    async def test_relayed_hold_reaches_shortcuts_and_link_release_lets_go(self):
        path, log = self.helper([gesture(1, BUTTON_HOLD), 'wait', {'kind': 'release', 'reason': 'stale'}])
        worker = bridge.Bridge()
        recognized = []
        worker.shortcuts.on_recognized = recognized.append
        released = []
        held_seen = []
        original = worker.release_all
        def release(reason=''):
            held_seen.append(set(worker.shortcuts.held_fingers))
            released.append(reason)
            original(reason)
        worker.release_all = release
        with patch.object(bridge, 'emit'):
            await self.run_source(worker, path, lambda: 'stale' in released)
        self.assertIn('hold-index', recognized, 'A phone gesture is recognized like a band gesture')
        self.assertIn({'index'}, held_seen, 'The hold was active when the link went stale')
        self.assertEqual(worker.shortcuts.held_fingers, set(), 'Stale link releases the hold')
        sent = self.commands(log)
        self.assertEqual(sent[0], {'cmd': 'demand', 'active': True, 'gyro': False, 'orientation': False})
        self.assertIn({'cmd': 'holding', 'value': True}, sent, 'The helper is told a hold started, so it can watch the link')

    async def test_link_loss_releases_mouse_button_and_ignores_later_events(self):
        path, _ = self.helper([{'kind': 'link', 'state': 'away', 'phone': 'Test iPhone', 'phones': []}, gesture(1, BUTTON_HOLD)])
        worker = bridge.Bridge()
        recognized = []
        worker.shortcuts.on_recognized = recognized.append
        with patch.object(bridge, 'emit'), patch.object(bridge, 'release_hold') as release_mouse:
            await self.run_source(worker, path, lambda: worker.link.get('state') == 'away' and release_mouse.called)
            await asyncio.sleep(0.1)
        self.assertTrue(release_mouse.called)
        self.assertNotIn('hold-index', recognized, 'Events after the link drops are not acted on')

    async def test_helper_crash_releases_and_restarts(self):
        path, _ = self.helper([gesture(1, BUTTON_HOLD)])
        worker = bridge.Bridge()
        with open(path) as f:
            body = f.read().replace('for line in sys.stdin:', 'sys.exit(3)\nfor line in sys.stdin:')
        with open(path, 'w') as f:
            f.write(body)
        reasons = []
        worker.release_all = lambda reason='': reasons.append(reason)
        with patch.object(bridge, 'emit'):
            await self.run_source(worker, path, lambda: 'Phone link restarted' in reasons)
        self.assertIn('Phone link restarted', reasons)


class GateTests(unittest.IsolatedAsyncioTestCase):
    async def test_mac_never_starts_a_direct_band_connection(self):
        previous = bridge.DIRECT_BAND
        bridge.DIRECT_BAND = False
        try:
            worker = bridge.Bridge()
            with patch.object(bridge, 'emit') as emitted:
                for action in ('discover', 'connect', 'enroll', 'identities'):
                    self.assertTrue(await worker.command({'action': action, 'device_id': 'band', 'request_id': 'x'}))
            self.assertIsNone(worker.session)
            self.assertFalse(any(call.args and call.args[0] in ('devices', 'identities') for call in emitted.call_args_list))
        finally:
            bridge.DIRECT_BAND = previous

    async def test_shortcut_configuration_updates_demand(self):
        worker = bridge.Bridge()
        demands = []
        class Source(event_sources.EventSource):
            def set_demand(self, demand): demands.append(demand)
        worker.source = Source()
        with patch.object(bridge, 'emit'):
            await worker.command({'action': 'configure_shortcuts', 'assignments': [{'id': 'hold-index', 'enabled': True, 'appAction': {'type': 'adjust', 'movement': 'rotation', 'axis': 'x', 'sensitivity': 5, 'increase': None, 'decrease': None}}]})
            await worker.command({'action': 'motion_view', 'enabled': False})
        self.assertTrue(demands[-1].motion)


if __name__ == '__main__':
    unittest.main()
