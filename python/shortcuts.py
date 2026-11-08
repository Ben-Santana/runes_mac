"""macOS key delivery and a conservative gesture recognizer. No simulated packets enter here."""
try:
    from .macos_actions import valid_macos_action
except ImportError:
    from macos_actions import valid_macos_action
try:
    from .api_calls import valid_api_action
except ImportError:
    from api_calls import valid_api_action

try:
    from .air_gestures import valid_air, wrist_point, path_length, similarity
except ImportError:
    from air_gestures import valid_air, wrist_point, path_length, similarity

import ctypes
import math
import sys
import time
import threading

KEY_CODES = dict(zip('ASDFHGZXCV', range(10)))
KEY_CODES.update(dict(zip('BQWERYT123465=97-80]OU[IP', range(11,36))))
KEY_CODES.update({'Enter':36,'L':37,'J':38,"'":39,'K':40,';':41,'\\':42,',':43,'/':44,'N':45,'M':46,'.':47,'Tab':48,'Space':49,'`':50,'Backspace':51,'Escape':53,'Delete':117,'ArrowLeft':123,'ArrowRight':124,'ArrowDown':125,'ArrowUp':126})
KEY_CODES.update(dict(zip([f'F{i}' for i in range(1,13)],[122,120,99,118,96,97,98,100,101,109,103,111])))
FLAGS = {'command':1<<20,'shift':1<<17,'option':1<<19,'control':1<<18}
# Arrow events carry numeric-pad and secondary-Fn flags even on laptop keyboards.
# Mission Control needs these key-specific flags to recognize Control–arrow.
ARROW_FLAGS = (1 << 21) | (1 << 23)
MOTIONS = {'swipe-left','swipe-right','swipe-up','swipe-down','tap-index','tap-middle','double-tap-index','double-tap-middle','hold-index','hold-middle'}
COMBO_TIMES = {200,300,500,750,1000,1500,2000,3000,5000}

def active_holds(steps):
    held = set()
    for step in steps:
        gesture = step.get('gesture', '')
        if gesture.startswith('hold-'):
            finger = gesture[5:]
            if finger in held:
                return None
            held.add(finger)
        elif gesture.startswith('release-'):
            finger = gesture[8:]
            if finger not in held:
                return None
            held.remove(finger)
    return held

def valid_steps(steps):
    return (isinstance(steps,list) and 2 <= len(steps) <= 8
            and all(isinstance(s,dict) and (s.get('direction') is None or (s.get('gesture') == 'rotation' and s.get('direction') in ('left','right','any'))) and (s.get('gesture') in MOTIONS
                    or s.get('gesture') in ('release-index','release-middle')
                    or (s.get('gesture') == 'air' and valid_air(s.get('air')))
                    or (s.get('gesture') in ('rotation','movement') and s.get('axis') in ('x','y','z'))) for s in steps)
            and active_holds(steps) is not None
            and all(s['gesture'] != 'air' or (i > 0 and steps[i-1]['gesture'] != 'air') for i,s in enumerate(steps)))

def shortcut_keys(shortcut):
    return shortcut.get('keys', [shortcut.get('key')])

def valid_shortcut(shortcut):
    if not isinstance(shortcut, dict):
        return False
    keys = shortcut_keys(shortcut)
    return (isinstance(keys, list) and 0 < len(keys) <= len(KEY_CODES)
            and all(isinstance(k, str) and k in KEY_CODES for k in keys)
            and len(set(keys)) == len(keys) and keys[0] == shortcut.get('key')
            and isinstance(shortcut.get('modifiers'), list)
            and all(isinstance(m, str) and m in FLAGS for m in shortcut['modifiers']))

def valid_adjust_output(action):
    return (valid_shortcut(action) or isinstance(action, dict) and action.get('type') not in ('radial-menu', 'adjust', 'mouse-movement')
            and (valid_action_step(action) if action.get('type') == 'shortcut' else valid_app_action(action)))

def valid_adjust(action):
    return (isinstance(action, dict) and action.get('type') == 'adjust'
            and action.get('movement') in ('rotation', 'movement') and action.get('axis') in ('x','y','z')
            and type(action.get('sensitivity')) is int and 1 <= action['sensitivity'] <= 10
            and 'increase' in action and 'decrease' in action
            and (action['increase'] is None or valid_adjust_output(action['increase']))
            and (action['decrease'] is None or valid_adjust_output(action['decrease'])))

def valid_action_step(action):
    return isinstance(action, dict) and (valid_shortcut(action.get('shortcut')) if action.get('type') == 'shortcut' else action.get('type') not in ('radial-menu', 'sequence', 'open-profile-picker', 'adjust', 'mouse-movement') and valid_app_action(action))

def mouse_inputs(action):
    if 'right' in action or 'up' in action:
        return action.get('right'), action.get('up')
    plane = action.get('plane', '')
    if action.get('movement') in ('rotation', 'movement') and plane in ('xy', 'xz', 'yz'):
        return tuple(dict(movement=action['movement'], axis=axis) for axis in plane)
    return None, None

def valid_mouse(action):
    return (isinstance(action, dict) and action.get('type') == 'mouse-movement'
            and all(isinstance(i, dict) and i.get('movement') in ('rotation', 'movement')
                    and i.get('axis') in ('x', 'y', 'z')
                    and ('inverted' not in i or isinstance(i['inverted'], bool)) for i in mouse_inputs(action)))

def valid_radial(action):
    if not isinstance(action, dict) or action.get('type') != 'radial-menu':
        return False
    items = action.get('items')
    return (isinstance(items, list) and 1 <= len(items) <= 8
            and all(isinstance(i, dict) and isinstance(i.get('id'), str) and bool(i['id']) and ('icon' not in i or isinstance(i['icon'], str) and len(i['icon']) <= 64) and ('name' not in i or isinstance(i['name'], str) and len(i['name']) <= 80) and ('angle' not in i or type(i['angle']) in (int, float) and 0 <= i['angle'] < 2 * math.pi) and valid_adjust_output(i.get('output')) for i in items)
            and len({i['id'] for i in items}) == len(items))


def valid_type_text(action):
    text = action.get('text') if isinstance(action, dict) else None
    return (isinstance(action, dict) and action.get('type') == 'type-text'
            and isinstance(text, str) and bool(text)
            and all((ord(c) >= 32 or c in '\t\r\n') and ord(c) != 127
                    and not 0xD800 <= ord(c) <= 0xDFFF for c in text))


def valid_app_action(action):
    return isinstance(action, dict) and (valid_radial(action) or valid_mouse(action) or valid_adjust(action) or (action.get('type') == 'sequence' and isinstance(action.get('actions'), list) and 2 <= len(action['actions']) <= 16 and all(valid_action_step(step) for step in action['actions'])) or valid_macos_action(action) or valid_api_action(action) or valid_type_text(action) or action.get('type') in ('open-profile-picker', 'show-cheat-sheet') or (action.get('type') == 'move-profile' and action.get('direction') in ('up', 'down')) or (action.get('type') == 'change-profile' and isinstance(action.get('profileId'), str) and bool(action['profileId'])))

class MacKeyboard:
    def __init__(self):
        self.cg = None
        self.lock = threading.RLock()

    def _ready(self):
        if sys.platform != 'darwin':
            raise RuntimeError('Keyboard shortcuts are available on macOS only.')
        if self.cg is None:
            self.cg = ctypes.CDLL('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices')
            self.cg.AXIsProcessTrusted.restype = ctypes.c_bool
            self.cg.CGEventCreateKeyboardEvent.argtypes = [ctypes.c_void_p,ctypes.c_uint16,ctypes.c_bool]
            self.cg.CGEventCreateKeyboardEvent.restype = ctypes.c_void_p
            self.cg.CGEventSetFlags.argtypes = [ctypes.c_void_p,ctypes.c_uint64]
            self.cg.CGEventPost.argtypes = [ctypes.c_uint32,ctypes.c_void_p]
            self.cg.CFRelease.argtypes = [ctypes.c_void_p]
        if not self.cg.AXIsProcessTrusted():
            raise RuntimeError('Enable Accessibility for Runes and its Python helper in System Settings to send shortcuts.')
    def send(self, shortcut):
        with self.lock:
            self._send(shortcut)

    def _send(self, shortcut):
        self._ready()
        flags = sum(FLAGS[m] for m in set(shortcut['modifiers']))
        keys = shortcut_keys(shortcut)
        events = []
        try:
            # Build the full sequence before posting so allocation errors cannot leave keys held.
            for down, chord in ((True, keys), (False, reversed(keys))):
                for key in chord:
                    event = self.cg.CGEventCreateKeyboardEvent(None,KEY_CODES[key],down)
                    if not event:
                        raise RuntimeError('macOS could not create a keyboard event.')
                    events.append(event)
                    self.cg.CGEventSetFlags(event, flags | (ARROW_FLAGS if key.startswith('Arrow') else 0))
            for event in events:
                self.cg.CGEventPost(0,event)
        finally:
            for event in events:
                self.cg.CFRelease(event)


    def type_text(self, text):
        if not valid_type_text({'type': 'type-text', 'text': text}):
            raise ValueError('Invalid text action.')
        with self.lock:
            self._ready()
            self.cg.CGEventKeyboardSetUnicodeString.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_uint16)]
            # Keep each event below Quartz's Unicode payload limit, without splitting emoji.
            text = text.replace('\r\n', '\n').replace('\r', '\n')
            offset = 0
            while offset < len(text):
                if text[offset] in '\n\t':
                    self._send({'key': 'Enter' if text[offset] == '\n' else 'Tab', 'modifiers': []})
                    offset += 1
                else:
                    end = offset
                    while end < min(offset + 16, len(text)) and text[end] not in '\n\t':
                        end += 1
                    encoded = text[offset:end].encode('utf-16-le')
                    units = (ctypes.c_uint16 * (len(encoded) // 2)).from_buffer_copy(encoded)
                    events = []
                    try:
                        for down in (True, False):
                            event = self.cg.CGEventCreateKeyboardEvent(None, 0, down)
                            if not event:
                                raise RuntimeError('macOS could not create a text event.')
                            events.append(event)
                            self.cg.CGEventSetFlags(event, 0)
                            self.cg.CGEventKeyboardSetUnicodeString(event, len(units), units)
                        for event in events:
                            self.cg.CGEventPost(0, event)
                    finally:
                        for event in events:
                            self.cg.CFRelease(event)
                    offset = end
                time.sleep(.005)

class ShortcutEngine:
    def __init__(self, deliver, clock=time.monotonic, on_recognized=None, on_progress=None, on_input=None, on_outcome=None, on_action=None, on_adjust=None, on_air_preview=None, on_air_result=None):
        self.deliver, self.clock = deliver, clock
        self.on_recognized = on_recognized or (lambda motion: None)
        self.on_progress = on_progress or (lambda candidates: None)
        self.on_input = on_input or (lambda event: None)
        self.on_outcome = on_outcome or (lambda outcome: None)
        self.on_action = on_action or (lambda: None)
        self.on_adjust = on_adjust or (lambda: None)
        self.on_air_preview = on_air_preview or (lambda state: None)
        self.on_air_result = on_air_result or (lambda state: None)
        self.air_preview_enabled = False
        self.air_preview_last = {'active':False}
        self.air_preview_at = -math.inf
        self.input_sequence = 0
        self.assignments = {}
        self.combos = {}
        self.suspended = True
        self.picker_open = False
        self.reset()

    def configure(self, assignments):
        self.assignments, self.combos = {}, {}
        for a in assignments if isinstance(assignments,list) else []:
            if not isinstance(a,dict):
                continue
            ident = a.get('id')
            is_combo = isinstance(ident,str) and ident.startswith('combo-') and valid_steps(a.get('steps')) and a.get('intervalMs') in COMBO_TIMES
            action = a.get('appAction') or {}
            final = a['steps'][-1]['gesture'] if is_combo else ident
            if action.get('type') == 'adjust' and (not isinstance(final, str) or not final.startswith('hold-')):
                continue
            if is_combo:
                self.combos[ident] = a
            if (a.get('appAction') or {}).get('type') == 'open-profile-picker' and isinstance(ident, str) and (ident.startswith('tap-') or ident.startswith('double-tap-')):
                continue
            if (ident in MOTIONS or is_combo) and a.get('enabled') is True and (valid_shortcut(a.get('shortcut')) or valid_app_action(a.get('appAction'))):
                self.assignments[ident] = {'appAction': a['appAction']} if valid_app_action(a.get('appAction')) else a['shortcut']
        self.reset()

    def reset(self):
        self.adjustment = None
        self.mouse = None
        self.pending = {}
        self.orientation = None
        self.orientation_at = -math.inf
        self.air_captures = {}
        self.rotation_origin = None
        self.movement_active = set()
        self.progress = {}
        self.combo_events = []
        self.deferred_actions = []
        self.buffered_actions = {}
        self.held_fingers = set()
        self.last = {}
        self.last_event = {}
        self.last_progress = []
        self.on_progress([])
        self.publish_air_preview()

    def trigger(self, motion):
        now = self.clock()
        if self.picker_open or self.suspended or motion not in self.assignments or now-self.last.get(motion,-100) < .35:
            return
        if self.adjustment:
            return
        self.last[motion] = now
        mapping = self.assignments[motion]
        action = mapping.get('appAction', {})
        if action.get('type') == 'mouse-movement':
            turning_on = not (self.mouse and self.mouse['id'] == motion)
            self.mouse = None if not turning_on else {'id':motion, 'action':action, 'orientation':self.orientation, 'last_packet':now}
            if turning_on:
                self.on_action()
            return
        if action.get('type') == 'adjust':
            final = self.combos[motion]['steps'][-1]['gesture'] if motion in self.combos else motion
            finger = final[5:]
            if finger in self.held_fingers:
                self.adjustment = {'action':action, 'finger':finger, 'orientation':self.orientation,
                                   'remainder':0., 'direction':0, 'last_packet':now, 'budget':4., 'budget_at':now}
                self.on_action()
            return
        if self.deliver(mapping):
            kind = (mapping.get('appAction') or {}).get('type')
            if kind not in ('open-profile-picker', 'radial-menu'):
                self.on_action()

    def recognize(self, gesture, axis=None, at=None, direction=None):
        now = self.clock() if at is None else at
        token = (gesture,axis,direction)
        # Raw and derived gesture layers describe the same physical action.
        if now-self.last_event.get(token,-100) < .08:
            return
        self.last_event[token] = now
        if gesture in MOTIONS:
            self.on_recognized(gesture)
        self.input_sequence += 1
        ident = self.input_sequence
        if any(combo_id in self.assignments and any(step['gesture'] == gesture for step in combo['steps'])
               for combo_id, combo in self.combos.items()):
            # Wait for physical-order processing before deciding who owns this input.
            if not self.suspended and not self.picker_open:
                self.buffered_actions[ident] = gesture
        else:
            self.trigger(gesture)
        if gesture not in ('rotation','movement'):
            self.on_input({'id':ident,'gesture':gesture,'axis':axis,'at':now})
        self.combo_events.append((now,gesture,axis,ident,direction))
        self.flush_combo_events()

    def flush_combo_events(self):
        # Only an earlier, unresolved tap can change physical event order.
        # Once a gesture is recognized, publish its next steps in the same call
        # instead of holding every event for another double-tap window.
        pending_at = min((at for _, at in self.pending.values()), default=None)
        ready = sorted(event for event in self.combo_events if pending_at is None or event[0] < pending_at)
        self.combo_events = [event for event in self.combo_events if pending_at is not None and event[0] >= pending_at]
        for at, gesture, axis, input_id, direction in ready:
            self.advance_combos(at, gesture, axis, input_id, direction)
            self.resolve_actions()
        self.sync_air_captures()
        self.publish_progress()
        self.resolve_actions()

    def advance_combos(self, now, gesture, axis, input_id, direction=None):
        action = self.buffered_actions.pop(input_id, None)
        if action:
            self.deferred_actions.append((action, {input_id}))
        def matches(step):
            return (gesture == step['gesture'] and axis == step.get('axis')
                    and (gesture != 'rotation' or step.get('direction', 'any') == 'any'
                         or step.get('direction') == direction))
        continuous = gesture in ('rotation','movement')
        if continuous:
            # Only surface motion when it starts or advances a real candidate.
            relevant = any(
                matches(combo['steps'][0])
                or any(matches(combo['steps'][index])
                       and now >= previous
                       and (active_holds(combo['steps'][:index]) or now-previous <= combo['intervalMs']/1000)
                       for index, previous, inputs in self.progress.get(ident,[]))
                for ident, combo in self.combos.items())
            if relevant:
                self.on_input({'id':input_id,'gesture':gesture,'axis':axis,'direction':direction,'at':now})
        for ident, combo in self.combos.items():
            steps = combo['steps']
            candidates = []
            for index, previous, inputs in self.progress.get(ident,[]):
                if continuous and not matches(steps[index]):
                    # Incidental motion neither breaks a combo nor extends its timer.
                    candidates.append((index,previous,inputs))
                    continue
                if gesture.startswith('release-') and gesture != steps[index]['gesture']:
                    # An early release invalidates every candidate requiring that hold.
                    if gesture[8:] not in active_holds(steps[:index]):
                        candidates.append((index,previous,inputs))
                    else:
                        self.finish_candidate(ident, inputs, 'failure', 'Released early')
                    continue
                # Time spent inside an active hold does not limit the next step,
                # including its release. Timing resumes after the last release.
                held = active_holds(steps[:index])
                in_time = now >= previous and (held or now-previous <= combo['intervalMs']/1000)
                if in_time and matches(steps[index]):
                    if index+1 == len(steps):
                        self.finish_candidate(ident, inputs+[input_id], 'success', 'Combo complete')
                        self.on_recognized(ident)
                        # Recognition owns inputs even in test mode or before an
                        # output is assigned. trigger() alone gates action delivery.
                        self.deferred_actions.append((ident, set(inputs+[input_id])))
                    else:
                        candidates.append((index+1,now,inputs+[input_id]))
                else:
                    self.finish_candidate(ident, inputs, 'failure', 'Unexpected input' if in_time else 'Timed out')
            if matches(steps[0]):
                candidates.append((1,now,[input_id]))
            self.progress[ident] = candidates

    def resolve_actions(self):
        # A completed larger combo owns its inputs, even while it waits for an
        # overlapping, longer candidate to finish.
        actions = self.deferred_actions
        self.deferred_actions = []
        consumed = set()
        preview_consumed = set()
        for motion, inputs in actions:
            mapped = motion in self.assignments
            if inputs & consumed or (not mapped and inputs & preview_consumed):
                continue
            if any(inputs < other_inputs and (not mapped or other_motion in self.assignments)
                   for other_motion, other_inputs in actions):
                continue
            blocked = any(
                inputs.issubset(candidate_inputs) and len(combo['steps']) > len(inputs)
                for ident, combo in self.combos.items() if not mapped or ident in self.assignments
                for _, _, candidate_inputs in self.progress.get(ident, []))
            if blocked:
                self.deferred_actions.append((motion, inputs))
            else:
                self.trigger(motion)
                if motion in self.combos:
                    (consumed if mapped else preview_consumed).update(inputs)
                    # Drop every overlapping attempt, including suffixes started by
                    # the final movement. A completed combo cannot seed the next one.
                    for ident, candidates in self.progress.items():
                        # An unassigned preview must not cancel a live shortcut.
                        if not mapped and ident in self.assignments:
                            continue
                        live = []
                        for candidate in candidates:
                            if inputs.intersection(candidate[2]):
                                self.finish_candidate(ident, candidate[2], 'failure', 'Movements used by completed combo')
                            else:
                                live.append(candidate)
                        self.progress[ident] = live
        if consumed or preview_consumed:
            self.deferred_actions = [(motion, inputs) for motion, inputs in self.deferred_actions
                                     if not inputs & consumed and
                                     (motion in self.assignments or not inputs & preview_consumed)]
            self.publish_progress()

    def finish_candidate(self, ident, inputs, status, reason):
        self.on_outcome({'id':ident,'attemptId':f'{ident}:{inputs[0]}',
                         'inputIds':inputs,'status':status,'reason':reason})

    def publish_progress(self):
        # Allow the tap-disambiguation window before expiring a candidate: a raw
        # tap inside its deadline may still be waiting to become a single tap.
        now = self.clock()-.3
        tracked = []
        for ident, candidates in self.progress.items():
            combo = self.combos[ident]
            interval = combo['intervalMs']/1000
            live = []
            for index, at, inputs in candidates:
                if combo['steps'][index]['gesture'] == 'air' or active_holds(combo['steps'][:index]) or now-at <= interval:
                    live.append((index,at,inputs))
                else:
                    self.finish_candidate(ident, inputs, 'failure', 'Timed out')
            self.progress[ident] = live
            for index, at, inputs in live:
                air = combo['steps'][index].get('air') if combo['steps'][index]['gesture'] == 'air' else None
                held = not air and bool(active_holds(combo['steps'][:index]))
                if air:
                    session = self.air_captures.get((ident,index,tuple(inputs)))
                    remaining = max(0,session['end']-self.clock()) if session else 0
                else:
                    remaining = min(interval,max(0,interval-(now-at)))
                tracked.append({'id':ident,'attemptId':f'{ident}:{inputs[0]}','inputIds':inputs,'matched':index,'holding':held,
                                'remainingMs':None if held else round(remaining*1000)})
        if tracked != self.last_progress:
            self.last_progress = tracked
            self.on_progress(tracked)

    def flush(self):
        if self.mouse and (self.suspended or self.picker_open):
            self.mouse = None
        if self.adjustment and (self.suspended or self.picker_open or self.clock()-self.adjustment['last_packet'] > .5):
            self.adjustment = None
        for finger, (deadline, at) in list(self.pending.items()):
            if self.clock() >= deadline:
                del self.pending[finger]
                self.recognize('tap-'+finger, at=at)
        self.flush_combo_events()
        self.finish_air_captures()

    def sync_air_captures(self):
        live = {}
        now = self.clock()
        for ident,candidates in self.progress.items():
            for index,at,inputs in candidates:
                step = self.combos[ident]['steps'][index]
                if step['gesture'] != 'air':
                    continue
                key = (ident,index,tuple(inputs))
                session = self.air_captures.get(key)
                if session is None:
                    session = {'start':now,'end':now+step['air']['durationMs']/1000,
                               'reference':self.orientation,'points':[], 'last':now,
                               'invalid':self.orientation is None or now-self.orientation_at > .5}
                live[key] = session
        removed=set(self.air_captures)-set(live)
        self.report_air_result(removed)
        self.air_captures = live
        self.publish_air_preview()

    def report_air_result(self, keys, winner=None):
        eligible=[key for key in keys if key in self.air_captures and key[0] in self.assignments
                  and not self.air_captures[key].get('result_reported')]
        for key in keys:
            if key in self.air_captures:
                self.air_captures[key]['result_reported']=True
        if not eligible or not self.air_preview_enabled or self.suspended or self.picker_open:
            return
        key=winner if winner in eligible else min(eligible)
        session=self.air_captures[key]
        attempt=f'{key[0]}:{key[2][0]}:{key[1]}'
        self.on_air_result({'result':'success' if winner else 'failure','attemptId':attempt,
                            'resultId':attempt,'points':[[0.,0.]]+[list(p) for _,p in session['points']]})

    def publish_air_preview(self):
        now = self.clock()
        live = [(key,session) for key,session in self.air_captures.items()
                if key[0] in self.assignments and not session['invalid']
                and now-session['last'] <= .5 and now < session['end']]
        if self.air_captures and not live and all(s['invalid'] or now-s['last']>.5 for s in self.air_captures.values()):
            self.report_air_result(set(self.air_captures))
        state = {'active':False}
        if self.air_preview_enabled and not self.suspended and not self.picker_open and live:
            key,session = min(live,key=lambda item:(item[1]['start'],item[0]))
            state = {'active':True,'attemptId':f'{key[0]}:{key[2][0]}:{key[1]}',
                     'points':[[0.,0.]]+[list(p) for _,p in session['points']]}
        # Start/stop and attempt changes are immediate; drawing is capped at 30 Hz.
        changed = (state.get('active'),state.get('attemptId')) != (self.air_preview_last.get('active'),self.air_preview_last.get('attemptId'))
        if state != self.air_preview_last and (changed or now-self.air_preview_at >= 1/30):
            self.air_preview_last = state
            self.air_preview_at = now
            self.on_air_preview(state)

    def finish_air_captures(self):
        # Candidates sharing an input compete in one arbitration group. Keep each
        # one's own window; wait for all windows before picking by similarity.
        remaining = set(self.air_captures)
        groups = []
        while remaining:
            group = {remaining.pop()}
            inputs = set(next(iter(group))[2])
            while True:
                linked = {key for key in remaining if inputs.intersection(key[2])}
                if not linked:
                    break
                group.update(linked)
                remaining.difference_update(linked)
                for key in linked:
                    inputs.update(key[2])
            groups.append(group)
        now = self.clock()
        for group in groups:
            # Disabled previews must not delay an enabled mapping's window.
            eligible = {key for key in group if key[0] in self.assignments} or group
            if any(now < self.air_captures[key]['end'] for key in eligible):
                continue
            ranked = []
            for key in eligible:
                session = self.air_captures[key]
                points = [p for at,p in session['points']]
                if session['invalid'] or session['end']-session['last'] > .5 or len(points) < 10 or path_length(points) < .067:
                    continue
                air = self.combos[key[0]]['steps'][key[1]]['air']
                score = similarity(air['points'],points)
                if score is not None and score >= air['minSimilarity']:
                    ranked.append((score,key))
            # Stable id breaks exact ties, never assignment iteration order.
            # Unassigned previews do not steal inputs from enabled mappings.
            mapped = [r for r in ranked if r[1][0] in self.assignments]
            winner = sorted(mapped or ranked,key=lambda r:(-r[0],r[1]))[0][1] if ranked else None
            self.report_air_result(group,winner)
            self.input_sequence += 1
            input_id = self.input_sequence
            if winner:
                self.on_input({'id':input_id,'gesture':'air','air':self.combos[winner[0]]['steps'][winner[1]]['air'],'at':now,'similarity':next(r[0] for r in ranked if r[1] == winner)})
            for key in sorted(group):
                ident,index,inputs = key
                self.progress[ident] = [c for c in self.progress.get(ident,[]) if (c[0],tuple(c[2])) != (index,inputs)]
                if key != winner:
                    self.finish_candidate(ident,list(inputs),'failure','Another air gesture matched better' if winner else 'Air gesture below minimum similarity or orientation interrupted')
                    continue
                steps = self.combos[ident]['steps']
                matched = list(inputs)+[input_id]
                if index+1 == len(steps):
                    self.finish_candidate(ident,matched,'success','Air gesture matched')
                    self.on_recognized(ident)
                    self.deferred_actions.append((ident,set(matched)))
                else:
                    self.progress[ident].append((index+1,now,matched))
        self.sync_air_captures()
        self.publish_progress()
        self.resolve_actions()

    def mouse_motion(self, kind, values):
        session = self.mouse
        if not session or self.suspended or self.picker_open:
            return
        action = session['action']
        inputs = mouse_inputs(action)
        if not any(kind == ('Orientation' if i['movement'] == 'rotation' else 'Gyroscope') for i in inputs):
            return
        now = self.clock()
        dt = now-session.get(kind, session['last_packet'])
        session[kind] = now
        if kind == 'Orientation':
            origin = session['orientation']
            session['orientation'] = values
            if origin is None or dt > .5:
                return
            w,x,y,z = origin
            a,b,c,d = values
            relative = [w*a+x*b+y*c+z*d, w*b-x*a-y*d+z*c,
                        w*c+x*d-y*a-z*b, w*d-x*c+y*b-z*a]
            deltas = [((math.degrees(2*math.atan2(v, relative[0]))+180)%360-180)*12 for v in relative[1:]]
        else:
            if dt > .5:
                return
            deltas = [v*min(dt,.1)*2 if abs(v)>=30 else 0 for v in values]
        dx,dy = [max(-100,min(100,deltas['xyz'.index(i['axis'])] * (-1 if i.get('inverted') else 1)))
                 if kind == ('Orientation' if i['movement'] == 'rotation' else 'Gyroscope') else 0 for i in inputs]
        if dx or dy:
            self.deliver({'mouseMove':{'dx':dx,'dy':-dy}})

    def adjust_motion(self, kind, values):
        session = self.adjustment
        if not session:
            return
        now = self.clock()
        if self.suspended or self.picker_open or now-session['last_packet'] > .5:
            self.adjustment = None
            return
        action = session['action']
        dt = now-session['last_packet']
        if kind != ('Orientation' if action['movement'] == 'rotation' else 'Gyroscope'):
            return
        session['last_packet'] = now
        axis = 'xyz'.index(action['axis'])
        if kind == 'Orientation':
            origin = session['orientation']
            session['orientation'] = values
            if origin is None:
                return
            w,x,y,z = origin
            a,b,c,d = values
            relative = [w*a+x*b+y*c+z*d, w*b-x*a-y*d+z*c,
                        w*c+x*d-y*a-z*b, w*d-x*c+y*b-z*a]
            delta = math.degrees(2*math.atan2(relative[axis+1], relative[0]))
            delta = (delta+180)%360-180
            threshold = 22-action['sensitivity']*2
        else:
            # Gyroscope wire units are uncalibrated; integrate rather than repeat at rest.
            delta = values[axis]*min(dt,.1) if abs(values[axis]) >= 30 else 0
            threshold = 110-action['sensitivity']*10
        direction = 1 if delta > 0 else -1 if delta < 0 else 0
        if direction and session['direction'] != direction:
            session['remainder'] = 0.
            session['direction'] = direction
        session['remainder'] += delta
        count = int(abs(session['remainder'])/threshold)
        session['budget'] = min(4., session['budget']+(now-session['budget_at'])*20)
        session['budget_at'] = now
        if count:
            # Bound bursts and rate; retain only fractional motion, never queued presses.
            session['remainder'] = math.copysign(abs(session['remainder'])%threshold, session['remainder'])
            repeats = min(count, int(session['budget']))
            session['budget'] -= repeats
            for _ in range(repeats):
                if self.adjustment is not session or self.suspended or self.picker_open:
                    break
                output = action['increase' if direction > 0 else 'decrease']
                if output is None:
                    break
                delivered = self.deliver(output['shortcut'] if output.get('type') == 'shortcut' else {'appAction':output} if 'type' in output else output)
                if delivered is not False:
                    self.on_adjust()

    def ingest(self, event):
        # Suspension gates key delivery in trigger(), not gesture recognition.
        self.flush()
        kind = event.get('type')
        if kind == 'Orientation':
            q = event.get('values',[])
            if len(q) != 4 or not all(isinstance(v,(float,int)) and math.isfinite(v) for v in q):
                return
            norm = math.sqrt(sum(v*v for v in q))
            if norm < 1e-8:
                return
            self.orientation = [v/norm for v in q]
            self.orientation_at = self.clock()
            for session in self.air_captures.values():
                if not session['invalid'] and self.clock() <= session['end'] and len(session['points']) < 4096:
                    if self.clock()-session['last'] > .5:
                        session['invalid'] = True
                    session['points'].append((self.clock(),wrist_point(self.orientation,session['reference'])))
                    session['last'] = self.clock()
            self.publish_air_preview()
            self.mouse_motion('Orientation', self.orientation)
            self.adjust_motion('Orientation', self.orientation)
            if self.rotation_origin is None:
                self.rotation_origin = self.orientation
                return
            # Relative quaternion, measured in the band's uncalibrated x/y/z frame.
            w,x,y,z = self.rotation_origin
            a,b,c,d = self.orientation
            relative = [w*a+x*b+y*c+z*d, w*b-x*a-y*d+z*c,
                        w*c+x*d-y*a-z*b, w*d-x*c+y*b-z*a]
            scalar = abs(relative[0])
            for axis, value in zip('xyz',relative[1:]):
                if 2*math.atan2(abs(value),scalar) > math.radians(25):
                    self.recognize('rotation',axis,direction='right' if value * (1 if relative[0] >= 0 else -1) > 0 else 'left')
                    self.rotation_origin = self.orientation
                    break
            return
        if kind == 'Gyroscope':
            values = event.get('values',[])
            if len(values)!=3 or not all(isinstance(v,(float,int)) and math.isfinite(v) for v in values):
                return
            self.mouse_motion('Gyroscope', values)
            self.adjust_motion('Gyroscope', values)
            for axis, value in zip('xyz',values):
                if abs(value)<30:
                    self.movement_active.discard(axis)
                elif abs(value)>80 and axis not in self.movement_active:
                    self.movement_active.add(axis)
                    self.recognize('movement',axis)
            return
        if kind != 'Gesture':
            return
        raw, derived, finger = event.get('action'),event.get('derived_action'),event.get('finger')
        if finger in ('index','middle') and derived == 'buttonHold':
            self.pending.pop(finger,None)
            if finger not in self.held_fingers:
                self.held_fingers.add(finger)
                self.recognize('hold-'+finger)
            return
        if finger in ('index','middle') and (raw == 'release' or derived in ('buttonRelease','buttonHoldRelease')):
            if self.adjustment and self.adjustment['finger'] == finger:
                self.adjustment = None
            if finger in self.held_fingers:
                self.held_fingers.remove(finger)
                self.recognize('release-'+finger)
            return
        directions = {'buttonLeft':'left','buttonRight':'right','buttonUp':'up','buttonDown':'down'}
        if derived in directions or raw in ('left','right','up','down'):
            self.recognize('swipe-'+directions.get(derived,raw))
        elif (derived == 'doubleTap' or raw == 'doubletap') and finger in ('index','middle'):
            self.pending.pop(finger,None)
            self.recognize('double-tap-'+finger)
        elif (derived == 'singleTap' or raw == 'tap') and finger in ('index','middle'):
            if finger not in self.pending:
                self.pending[finger] = (self.clock()+.3,self.clock())
