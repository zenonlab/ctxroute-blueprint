'use client';

import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {flipAxis,motionDuration,pointInRect,tiltAt,type CardPoint} from './card-motion';

type PhysicalCardProps={mode:'review-hover'|'media-modal';front:React.ReactNode;back:React.ReactNode;className?:string;label:string;href?:string};

function reducedMotion(){return typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches}
function setAxis(node:HTMLElement,point:CardPoint){const axis=flipAxis(point);node.style.setProperty('--flip-axis-x',String(axis.x));node.style.setProperty('--flip-axis-y',String(axis.y));node.style.setProperty('--flip-depth',String(axis.depth))}
function setTilt(node:HTMLElement,point:CardPoint){const tilt=tiltAt(point);node.style.setProperty('--tilt-x',`${tilt.x}deg`);node.style.setProperty('--tilt-y',`${tilt.y}deg`);node.style.setProperty('--glare-x',`${tilt.glareX}%`);node.style.setProperty('--glare-y',`${tilt.glareY}%`);node.style.setProperty('--shadow-x',`${tilt.shadowX}px`)}

export function PhysicalCard({mode,front,back,className='',label,href}:PhysicalCardProps){
  const root=useRef<HTMLDivElement>(null);const origin=useRef<HTMLElement|null>(null);const [open,setOpen]=useState(false);const [mounted,setMounted]=useState(false);const [start,setStart]=useState<DOMRect|null>(null);const [clickPoint,setClickPoint]=useState<CardPoint>({x:.5,y:.5});
  useEffect(()=>setMounted(true),[]);
  const point=(event:{clientX:number;clientY:number})=>pointInRect(event.clientX,event.clientY,root.current!.getBoundingClientRect());
  const enter=(event:React.PointerEvent)=>{if(mode!=='review-hover'||event.pointerType==='touch')return;setAxis(root.current!,point(event));requestAnimationFrame(()=>root.current?.classList.add('is-flipped'))};
  const move=(event:React.PointerEvent)=>{if(event.pointerType==='touch')return;setTilt(root.current!,point(event));root.current?.classList.add('is-tilting')};
  const leave=(event:React.PointerEvent)=>{if(mode!=='review-hover')return;setAxis(root.current!,point(event));root.current?.classList.remove('is-flipped','is-tilting');};
  const launch=(event:React.MouseEvent|React.KeyboardEvent)=>{if(mode!=='media-modal')return;event.preventDefault();origin.current=event.currentTarget as HTMLElement;const rect=root.current!.getBoundingClientRect();const clientX='clientX'in event&&event.clientX?event.clientX:rect.left+rect.width/2;const clientY='clientY'in event&&event.clientY?event.clientY:rect.top+rect.height/2;const selected=pointInRect(clientX,clientY,rect);setAxis(root.current!,selected);setClickPoint(selected);setStart(rect);setOpen(true)};
  const close=()=>setOpen(false);
  useEffect(()=>{if(!open)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';const key=(event:KeyboardEvent)=>{if(event.key==='Escape')close()};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',key);requestAnimationFrame(()=>origin.current?.focus())}},[open]);
  return <div ref={root} className={`physical-card ${mode} ${className}`} onPointerEnter={enter} onPointerMove={move} onPointerLeave={leave} data-motion-mode={mode}>
    <div className="physical-card-rotor">
      <div className="physical-card-face physical-card-front">{mode==='media-modal'?<a href={href} aria-label={label} onClick={launch} onKeyDown={event=>{if(event.key===' ')launch(event)}}>{front}</a>:front}</div>
      <div className="physical-card-face physical-card-back" aria-hidden={mode==='media-modal'}>{back}</div>
    </div>
    {mounted&&open&&createPortal(<MediaCardModal label={label} front={front} back={back} start={start!} clickPoint={clickPoint} onClose={close}/>,document.body)}
  </div>;
}

function MediaCardModal({label,front,back,start,clickPoint,onClose}:{label:string;front:React.ReactNode;back:React.ReactNode;start:DOMRect;clickPoint:CardPoint;onClose:()=>void}){
  const card=useRef<HTMLDivElement>(null);const closeButton=useRef<HTMLButtonElement>(null);
  useEffect(()=>{const node=card.current!;const targetWidth=Math.min(window.innerHeight*.52,window.innerWidth-32);const scaleX=start.width/targetWidth;const targetHeight=targetWidth*1.5;const scaleY=start.height/targetHeight;const dx=start.left+start.width/2-window.innerWidth/2;const dy=start.top+start.height/2-window.innerHeight/2;const axis=flipAxis(clickPoint);node.style.setProperty('--start-x',`${dx}px`);node.style.setProperty('--start-y',`${dy}px`);node.style.setProperty('--start-scale-x',String(scaleX));node.style.setProperty('--start-scale-y',String(scaleY));node.style.setProperty('--flip-axis-x',String(axis.x));node.style.setProperty('--flip-axis-y',String(axis.y));node.style.setProperty('--motion-duration',`${motionDuration(reducedMotion())}ms`);const frame=requestAnimationFrame(()=>{node.classList.add('is-open');closeButton.current?.focus()});return()=>cancelAnimationFrame(frame)},[start,clickPoint]);
  return <div className="physical-card-backdrop" data-testid="media-card-backdrop" onPointerDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <div ref={card} className="physical-card-modal" role="dialog" aria-modal="true" aria-label={label} onKeyDown={event=>{if(event.key==='Tab'){event.preventDefault();closeButton.current?.focus()}}}>
      <div className="physical-card-modal-rotor"><div className="physical-card-face physical-card-front">{front}</div><div className="physical-card-face physical-card-back">{back}<button ref={closeButton} className="button physical-card-close" type="button" onClick={onClose}>Fermer</button></div></div>
    </div>
  </div>;
}
