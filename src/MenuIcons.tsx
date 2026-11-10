import type {AdjustOutput} from './shortcuts';
import {Home,Briefcase,Code2,Music,Gamepad2,Camera,PenTool,Globe,Star,Heart,Monitor,Headphones,Hand,Terminal,ChartLine,Presentation,BookOpen,GraduationCap,MessageCircle,Mail,Mic,Video,Tv,Palette,Plane,Car,Bike,Dumbbell,Footprints,Coffee,Moon,Leaf,PawPrint,Rocket,Pointer,Keyboard,Globe2,List,ArrowUp,ArrowDown,Volume2,Volume1,VolumeX,Sun,SunDim,MonitorOff,Minus,EyeOff,X,Power,AppWindow,MousePointer2,Layers} from 'lucide-react';
/** Profile icons in picker order; keys match the phone (runes_ios/Shared/ProfileIcon.swift). `runes` is the app mark. */
export const profileIcons={runes:Hand,home:Home,work:Briefcase,code:Code2,terminal:Terminal,monitor:Monitor,keyboard:Keyboard,chart:ChartLine,presentation:Presentation,book:BookOpen,school:GraduationCap,chat:MessageCircle,mail:Mail,music:Music,headphones:Headphones,mic:Mic,video:Video,tv:Tv,game:Gamepad2,camera:Camera,design:PenTool,palette:Palette,globe:Globe,plane:Plane,car:Car,bike:Bike,fitness:Dumbbell,run:Footprints,coffee:Coffee,moon:Moon,sun:Sun,leaf:Leaf,paw:PawPrint,rocket:Rocket,star:Star,heart:Heart};
const icons=profileIcons;
export const menuIcons={...profileIcons,keyboard:Keyboard,web:Globe2,list:List,up:ArrowUp,down:ArrowDown,volume:Volume2,mute:VolumeX,sun:Sun,display:MonitorOff,minus:Minus,hide:EyeOff,close:X,power:Power,app:AppWindow,pointer:MousePointer2,layers:Layers};
export function OutputIcon({value,profiles,icon}:{value:AdjustOutput;profiles:{id:string;name:string;icon?:string}[];icon?:string}){
 let Icon=Keyboard;
 if('type' in value){
  if(value.type==='change-profile')Icon=icons[profiles.find(p=>p.id===value.profileId)?.icon as keyof typeof icons]??Home;
  else if(value.type==='move-profile')Icon=value.direction==='up'?ArrowUp:ArrowDown;
  else if(value.type==='show-cheat-sheet')Icon=List;
  else if(value.type==='open-profile-picker')Icon=Layers;
  else if(value.type==='api-call')Icon=Globe2;
  else if(value.type==='sequence')Icon=List;
  else if(value.type==='macos-action')Icon=({'click':MousePointer2,'click-hold':Pointer,'right-click':MousePointer2,'open-app':AppWindow,'open-shortcuts':Layers,'volume-up':Volume2,'volume-down':Volume1,'mute':VolumeX,'brightness-up':Sun,'brightness-down':SunDim,'sleep-display':MonitorOff,'minimize-window':Minus,'hide-app':EyeOff,'close-window':X,'quit-app':Power,'show-desktop':Monitor})[value.action];
 }
 if(icon&&Object.hasOwn(menuIcons,icon))Icon=menuIcons[icon as keyof typeof menuIcons];
 return <Icon size={26} strokeWidth={1.5} aria-hidden="true"/>;
}
