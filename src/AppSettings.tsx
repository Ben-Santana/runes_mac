import {useEffect, useState} from 'react';
import {ChevronDown} from 'lucide-react';
import type {AppSettings as Settings} from './types';
import {ComboDropdown} from './MotionSettings';
import {previewSound} from './connectBell';
import {loadSoundSettings, saveSoundSettings, soundOptions, type SoundSettings} from './soundSettings';

const viewerSideOptions = [
  {value: 'both', label: 'Both sides'},
  {value: 'left', label: 'Left only — recent gestures'},
  {value: 'right', label: 'Right only — next combo moves'},
];

export function AppSettings() {
  const [settings, setSettings] = useState<Settings>();
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sounds, setSounds] = useState<SoundSettings>(loadSoundSettings);
  useEffect(() => {
    window.band?.metaCredentials?.({action:'status'}).then(result=>setSaved(result.saved)).catch(()=>setError('Could not read Meta sign-in settings.'));
    window.band?.getSettings?.().then(setSettings).catch(() => setError('Could not load app settings.'));
  }, []);
  async function update(change: Partial<Settings>) {
    if (!window.band?.updateSettings) return;
    setBusy(true);
    setError('');
    try { setSettings(await window.band.updateSettings(change)); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save app settings.'); }
    finally { setBusy(false); }
  }
  async function credentials(action:'save'|'forget') {
    if(!window.band?.metaCredentials)return;
    setBusy(true);setError('');
    try {const result=await window.band.metaCredentials({action,...(action==='save'?{username,password}:{})});setSaved(result.saved);setEditing(false);setUsername('');setPassword('');}
    catch {setError('Could not update Meta credentials. Check Keychain access and try again.');}
    finally {setBusy(false);}
  }
  return <>
    <section><h2>App behavior</h2><p>Keep Neural available while you use other apps. Open or quit Neural from its menu bar icon.</p></section>
    <section className="panel settings-panel app-behavior">
      <div className="setting-row"><div><span id="background-label">Run in the background</span><p id="background-help">Keep the band connection and shortcuts active when you close the window.</p></div><button className="motion-toggle" role="switch" aria-labelledby="background-label" aria-describedby="background-help" aria-checked={settings?.runInBackground ?? false} disabled={!settings || busy} onClick={() => update({runInBackground: !settings?.runInBackground})}><span/></button></div>
      <div className="setting-row"><div><span id="floating-combo-label">Notch combo viewer</span><p id="floating-combo-help">Extend the notch during gestures. Recent movements appear on the left, and possible next movements on the right.</p></div><button className="motion-toggle" role="switch" aria-labelledby="floating-combo-label" aria-describedby="floating-combo-help" aria-checked={settings?.floatingComboViewer ?? false} disabled={!settings || busy} onClick={() => update({floatingComboViewer: !settings?.floatingComboViewer})}><span/></button></div>
      {settings?.floatingComboViewer&&<div className="setting-row"><div><label htmlFor="notch-viewer-sides">Viewer sides</label><p id="notch-viewer-sides-help">Choose which side of the notch expands.</p></div><ComboDropdown id="notch-viewer-sides" describedBy="notch-viewer-sides-help" className="sound-choice" placement="below" label="Viewer sides" value={settings.notchComboViewerSides??'both'} options={viewerSideOptions} disabled={busy} onChange={value=>update({notchComboViewerSides:value as Settings['notchComboViewerSides']})}><span>{viewerSideOptions.find(option=>option.value===(settings.notchComboViewerSides??'both'))?.label}</span><ChevronDown size={12}/></ComboDropdown></div>}
      {settings?.floatingComboViewer&&<div className="setting-row"><div><span id="notch-names-label">Show menu names</span><p id="notch-names-help">Show the highlighted profile or radial menu option’s name beside the notch.</p></div><button className="motion-toggle" role="switch" aria-labelledby="notch-names-label" aria-describedby="notch-names-help" aria-checked={settings.notchMenuNames??true} disabled={busy} onClick={()=>update({notchMenuNames:!(settings.notchMenuNames??true)})}><span/></button></div>}
      <div className="setting-row"><div><span id="air-cursor-label">Air gesture cursor preview</span><p id="air-cursor-help">Show a dark circle around the mouse while an air gesture is expected. Your band's stroke starts in the center and scales to fit. Mouse clicks pass through.</p></div><button className="motion-toggle" role="switch" aria-labelledby="air-cursor-label" aria-describedby="air-cursor-help" aria-checked={settings?.airCursorOverlay ?? false} disabled={!settings || busy} onClick={() => update({airCursorOverlay: !settings?.airCursorOverlay})}><span/></button></div>
      <details className="radial-settings">
        <summary><span>Radial menus</span><ChevronDown size={16} aria-hidden="true"/></summary>
        <div className="radial-settings-body">
      <div className="setting-row"><div><span id="radial-compact-label">Icons-only radial menus</span><p id="radial-compact-help">Show small icons around the mouse pointer, with no text or instructions. Applies to radial menus and the profile picker.</p></div><button className="motion-toggle" role="switch" aria-labelledby="radial-compact-label" aria-describedby="radial-compact-help" aria-checked={settings?.compactRadialMenus ?? false} disabled={!settings || busy} onClick={() => update({compactRadialMenus: !settings?.compactRadialMenus})}><span/></button></div>
      <div className="setting-row"><div><span id="radial-follow-label">Radial menus follow the mouse</span><p id="radial-follow-help">The menu trails the pointer as a white ball, then opens after 0.8 seconds still or a wrist selection change. Choose items with band gestures; mouse clicks pass through. Also applies to the profile picker.</p></div><button className="motion-toggle" role="switch" aria-labelledby="radial-follow-label" aria-describedby="radial-follow-help" aria-checked={settings?.radialMenuFollowsMouse ?? false} disabled={!settings || busy} onClick={() => update({radialMenuFollowsMouse: !settings?.radialMenuFollowsMouse})}><span/></button></div>
      <div className="setting-row"><div><span id="radial-stay-label">Keep radial menu open after selection</span><p id="radial-stay-help">Run multiple actions without reopening the menu. Repeat its opening command to close it.</p></div><button className="motion-toggle" role="switch" aria-labelledby="radial-stay-label" aria-describedby="radial-stay-help" aria-checked={settings?.keepRadialMenuOpen ?? false} disabled={!settings || busy} onClick={() => update({keepRadialMenuOpen: !settings?.keepRadialMenuOpen})}><span/></button></div>
          <div className="setting-row"><div><span id="radial-sound-label">Selection sound</span><p id="radial-sound-help">Feedback as the highlight moves to a new item.</p></div><div className="sound-controls"><ComboDropdown className="sound-choice" placement="below" label="Radial menus voice" value={sounds.radial} options={soundOptions.map(option => ({value: option.value, label: option.label}))} onChange={next => {setSounds(saveSoundSettings({radial: next as SoundSettings["radial"]})); previewSound('radial');}}><span>{soundOptions.find(option => option.value === sounds.radial)?.label}</span><ChevronDown size={12}/></ComboDropdown><button className="motion-toggle" role="switch" aria-labelledby="radial-sound-label" aria-describedby="radial-sound-help" aria-checked={sounds.radialOn} onClick={() => {const next = saveSoundSettings({radialOn: !sounds.radialOn}); setSounds(next); if (next.radialOn) previewSound('radial');}}><span/></button></div></div>
        </div>
      </details>
      <div className="setting-row"><div><span id="login-label">Open at login</span><p id="login-help">Start Neural in the background when you sign in to your Mac.</p></div><button className="motion-toggle" role="switch" aria-labelledby="login-label" aria-describedby="login-help" aria-checked={settings?.openAtLogin ?? false} disabled={!settings?.loginAvailable || busy} onClick={() => update({openAtLogin: !settings?.openAtLogin})}><span/></button></div>
      {!settings?.loginAvailable && <p className="app-settings-note">Open the installed macOS app to configure launch at login.</p>}
      {settings?.loginStatus === 'requires-approval' && <p className="app-settings-note">Allow Neural in System Settings → General → Login Items to finish enabling launch at login.</p>}
      <div className="setting-row"><div><span id="meta-save-label">Save Meta password on this Mac</span><p id="meta-save-help">Store your email or phone number and password in macOS Keychain. Neural will try signing in automatically. Meta may still ask for a verification code.</p></div><button className="motion-toggle" role="switch" aria-labelledby="meta-save-label" aria-describedby="meta-save-help" aria-checked={saved} disabled={!window.band?.metaCredentials || busy} onClick={()=>saved?void credentials('forget'):setEditing(!editing)}><span/></button></div>
      {saved && <div className="settings-actions"><button className="button" disabled={busy} onClick={()=>setEditing(true)}>Update Meta password</button><button className="button" disabled={busy} onClick={()=>credentials('forget')}>Forget Meta password</button></div>}
      {editing && <form className="meta-credentials-form" onSubmit={event=>{event.preventDefault();void credentials('save');}}>
        <label htmlFor="meta-username">Meta email or phone number</label><input id="meta-username" autoComplete="username" value={username} onChange={event=>setUsername(event.target.value)} required disabled={busy}/>
        <label htmlFor="meta-password">Meta password</label><input id="meta-password" type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} required disabled={busy}/>
        <div className="settings-actions"><button className="button primary" type="submit" disabled={busy || !username.trim() || !password}>Save to Keychain</button><button className="button" type="button" disabled={busy} onClick={()=>{setEditing(false);setUsername('');setPassword('');}}>Cancel</button></div>
      </form>}
      {error && <p className="app-settings-note" role="alert">{error}</p>}
    </section>
    <section><h2>Sounds</h2><p>Choose from {soundOptions.length} sounds for combos, radial menus, and band connections. Every dropdown has the same library; select a sound to hear it.</p></section>
    <section className="panel settings-panel app-behavior">
      <div className="setting-row"><div><span id="sounds-label">Sounds</span><p id="sounds-help">Turn every sound on or off. The choices below stay saved.</p></div><button className="motion-toggle" role="switch" aria-labelledby="sounds-label" aria-describedby="sounds-help" aria-checked={sounds.enabled} onClick={() => setSounds(saveSoundSettings({enabled: !sounds.enabled}))}><span/></button></div>
      <div className="setting-row"><div><span id="air-result-sound-label">Air gesture results</span><p id="air-result-sound-help">Play a success or failure sound when the air gesture cursor preview finishes. The result fill always appears.</p></div><button className="motion-toggle" role="switch" aria-labelledby="air-result-sound-label" aria-describedby="air-result-sound-help" aria-checked={sounds.airOn} onClick={() => setSounds(saveSoundSettings({airOn: !sounds.airOn}))}><span/></button></div>
      <div className="setting-row"><div><span id="volume-label">Volume</span><p id="volume-help">How loud gesture, menu, and connection sounds are.</p></div><label className="sound-volume"><input aria-labelledby="volume-label" type="range" min={0} max={100} value={sounds.volume} onChange={event => setSounds(saveSoundSettings({volume: Number(event.target.value)}))} onPointerUp={() => previewSound('success')} onKeyUp={() => previewSound('success')}/><span>{sounds.volume}</span></label></div>
      {([
        ['step', 'Combo steps', 'A note as each gesture in a combo lands.', soundOptions, sounds.step, sounds.stepOn],
        ['success', 'Combo success', 'Played once, when a combo finishes.', soundOptions, sounds.success, sounds.successOn],
        ['connection', 'Connection', 'When the band connects or disconnects.', soundOptions, sounds.connection, sounds.connectionOn],
      ] as const).map(([kind, title, help, options, value, on]) => <div className="setting-row" key={kind}><div><span id={`${kind}-sound-label`}>{title}</span><p id={`${kind}-sound-help`}>{help}</p></div><div className="sound-controls"><ComboDropdown className="sound-choice" placement="below" label={`${title} voice`} value={value} options={options.map(option => ({value: option.value, label: option.label}))} onChange={next => {setSounds(saveSoundSettings({[kind]: next})); previewSound(kind);}}><span>{options.find(option => option.value === value)?.label}</span><ChevronDown size={12}/></ComboDropdown><button className="motion-toggle" role="switch" aria-labelledby={`${kind}-sound-label`} aria-describedby={`${kind}-sound-help`} aria-checked={on} onClick={() => {const next = saveSoundSettings({[`${kind}On`]: !on}); setSounds(next); if (!on) previewSound(kind);}}><span/></button></div></div>)}
    </section>
  </>;
}
