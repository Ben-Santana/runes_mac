export const soundOptions = [
 {value: 'whole', label: 'Whole step'},
 {value: 'pop', label: 'Pop'},
 {value: 'soft', label: 'Soft'},
 {value: 'lift', label: 'Lift'},
 {value: 'bell', label: 'Bell'},
 {value: 'hum', label: 'Hum'},
 {value: 'click', label: 'Click'},
 {value: 'tick', label: 'Tick'},
 {value: 'pip', label: 'Pip'},
 {value: 'bells', label: 'Bells'},
 {value: 'tone', label: 'Tone'},
 {value: 'tap', label: 'Tap'},
 {value: 'wood', label: 'Wood block'},
 {value: 'rim', label: 'Rimshot'},
 {value: 'pluck', label: 'Pluck'},
 {value: 'marimba', label: 'Marimba'},
 {value: 'kalimba', label: 'Kalimba'},
 {value: 'glass', label: 'Glass'},
 {value: 'sparkle', label: 'Sparkle'},
 {value: 'harp', label: 'Harp'},
 {value: 'sonar', label: 'Sonar'},
 {value: 'bubble', label: 'Bubble'},
 {value: 'droplet', label: 'Droplet'},
 {value: 'chirp', label: 'Chirp'},
 {value: 'blip', label: 'Arcade blip'},
 {value: 'coin', label: 'Coin'},
 {value: 'laser', label: 'Laser'},
 {value: 'swoosh', label: 'Swoosh'},
 {value: 'warm', label: 'Warm chord'},
 {value: 'resolve', label: 'Resolve'},
 {value: 'bounce', label: 'Bounce'},
 {value: 'shimmer', label: 'Shimmer'},
] as const;

export type SoundId = typeof soundOptions[number]['value'];

export type SoundSettings = {
 enabled: boolean;
 airOn: boolean;
 volume: number;
 step: SoundId;
 stepOn: boolean;
 success: SoundId;
 successOn: boolean;
 radial: SoundId;
 radialOn: boolean;
 connection: SoundId;
 connectionOn: boolean;
};

const key = 'runes.sounds.v1';
export const defaultSoundSettings: SoundSettings = {
 enabled: true,
 airOn: true,
 volume: 70,
 step: 'whole',
 stepOn: true,
 success: 'lift',
 successOn: true,
 radial: 'click',
 radialOn: true,
 connection: 'bells',
 connectionOn: true,
};

function choice<T extends string>(value: unknown, options: readonly {value: T}[], fallback: T): T {
 return options.some(option => option.value === value) ? value as T : fallback;
}

export function loadSoundSettings(): SoundSettings {
 try {
  const saved = JSON.parse(localStorage.getItem(key) || 'null') as Partial<SoundSettings> | null;
  if (!saved || typeof saved !== 'object') return {...defaultSoundSettings};
  return {
   enabled: saved.enabled !== false,
   airOn: saved.airOn !== false,
   volume: typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 100 ? Math.round(saved.volume) : defaultSoundSettings.volume,
   step: choice(saved.step, soundOptions, 'whole'),
   stepOn: saved.stepOn !== false,
   success: choice(saved.success, soundOptions, 'lift'),
   successOn: saved.successOn !== false,
   radial: choice(saved.radial, soundOptions, 'click'),
   radialOn: saved.radialOn !== false,
   connection: choice(saved.connection, soundOptions, 'bells'),
   connectionOn: saved.connectionOn !== false,
  };
 } catch {
  return {...defaultSoundSettings};
 }
}

export function saveSoundSettings(change: Partial<SoundSettings>): SoundSettings {
 const next = {...loadSoundSettings(), ...change};
 localStorage.setItem(key, JSON.stringify(next));
 return next;
}
