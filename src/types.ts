export type NotchViewerSides = 'both'|'left'|'right';
export type AppSettings = {runInBackground:boolean;compactRadialMenus:boolean;keepRadialMenuOpen:boolean;radialMenuFollowsMouse:boolean;floatingComboViewer:boolean;airCursorOverlay:boolean;notchComboViewerSides:NotchViewerSides;notchMenuNames:boolean;openAtLogin:boolean;loginAvailable:boolean;loginStatus?:string};
export type Packet = {type:string; received_at?:number; sequence?:number; timestamp?:number; values?:number[][]|number[]; finger?:string; action?:string; [key:string]:unknown};
export type Message = {kind:string; [key:string]:any};
export type Command = {action:string; [key:string]:unknown};
export type Device = {id:string;name:string;rssi?:number};
declare global { interface Window {band?:{identityQR?:(deviceId:string)=>Promise<string>;metaCredentials?:(request:{action:"status"|"save"|"forget";username?:string;password?:string})=>Promise<{saved:boolean}>;getSettings?:()=>Promise<AppSettings>;updateSettings?:(settings:Partial<AppSettings>)=>Promise<AppSettings>;send:(command:Command)=>void;onMessage:(callback:(message:Message)=>void)=>()=>void}} }
