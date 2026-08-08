'use client';

import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {flipAxis,motionDuration,pointInRect,tiltAt,type CardPoint} from './card-motion';

type PhysicalCardProps={mode:'review-hover'|'media-modal';front:React.ReactNode;back:React.ReactNode;className?:string;label:string;href?:string};
const prefersReducedMotion=()=>typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function setAxis(node:HTMLElement,point:CardPoint){const axis=flipAxis(point);node.style.setProperty('--flip-axis-x',String(axis.x));node.style.setProperty('--flip-axis-y',String(axis.y))}
function setTilt(node:HTMLElement,point:CardPoint){const tilt=tiltAt(point);node.style.setProperty('--tilt-x',`${tilt.x}deg`);node.style.setProperty('--tilt-y',`${tilt.y}deg`);node.style.setProperty('--glare-x',`${tilt.glareX}%`);node.style.setProperty('--glare-y',`${tilt.glareY}%`);node.style.setProperty('--shadow-x',`${tilt.shadowX}px`)}

export function PhysicalCard({mode,front,back,className='',label,href}:PhysicalCardProps){
  const card=useRef<HTMLDivElement>(null);const trigger=useRef<HTMLAnchorElement>(null);const closeButton=useRef<HTMLButtonElement>(null);const closeTimer=useRef<number|null>(null);
  const [open,setOpen]=useState(false);const [mounted,setMounted]=useState(false);
  useEffect(()=>setMounted(true),[]);
  const point=(event:{clientX:number;clientY:number})=>pointInRect(event.clientX,event.clientY,card.current!.getBoundingClientRect());
  const enter=(event:React.PointerEvent)=>{if(mode!=='review-hover'||event.pointerType==='touch')return;setAxis(card.current!,point(event));requestAnimationFrame(()=>card.current?.classList.add('is-flipped'))};
  const move=(event:React.PointerEvent)=>{if(event.pointerType==='touch'||open)return;setTilt(card.current!,point(event));card.current?.classList.add('is-tilting')};
  const leave=(event:React.PointerEvent)=>{if(mode!=='review-hover')return;setAxis(card.current!,point(event));card.current?.classList.remove('is-flipped','is-tilting')};
  const launch=(event:React.MouseEvent|React.KeyboardEvent)=>{
    if(mode!=='media-modal'||open)return;event.preventDefault();const node=card.current!,rect=node.getBoundingClientRect();const clientX='clientX'in event&&event.clientX?event.clientX:rect.left+rect.width/2;const clientY='clientY'in event&&event.clientY?event.clientY:rect.top+rect.height/2;
    const targetWidth=Math.min(window.innerHeight*.52,window.innerWidth-32),targetHeight=targetWidth*1.5,targetLeft=(window.innerWidth-targetWidth)/2,targetTop=(window.innerHeight-targetHeight)/2;
    setAxis(node,pointInRect(clientX,clientY,rect));node.classList.remove('is-tilting');node.style.setProperty('--card-left',`${targetLeft}px`);node.style.setProperty('--card-top',`${targetTop}px`);node.style.setProperty('--card-width',`${targetWidth}px`);node.style.setProperty('--card-height',`${targetHeight}px`);node.style.setProperty('--start-x',`${rect.left-targetLeft}px`);node.style.setProperty('--start-y',`${rect.top-targetTop}px`);node.style.setProperty('--start-scale-x',String(rect.width/targetWidth));node.style.setProperty('--start-scale-y',String(rect.height/targetHeight));node.style.setProperty('--motion-duration',`${motionDuration(prefersReducedMotion())}ms`);setOpen(true);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{node.classList.add('is-modal-open','is-flipped');closeButton.current?.focus()}));
  };
  const close=()=>{const node=card.current;if(!node)return;node.classList.remove('is-modal-open','is-flipped');const finish=()=>{setOpen(false);node.removeAttribute('style');requestAnimationFrame(()=>trigger.current?.focus())};if(prefersReducedMotion())finish();else closeTimer.current=window.setTimeout(finish,motionDuration(false))};
  useEffect(()=>{if(!open)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';const key=(event:KeyboardEvent)=>{if(event.key==='Escape')close()};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',key);if(closeTimer.current!==null)window.clearTimeout(closeTimer.current)}},[open]);
  const backContent=mode==='media-modal'?<>{back}<button ref={closeButton} className="button physical-card-close" type="button" onClick={close} disabled={!open}>Fermer</button></>:back;
  return <div className={`physical-card-slot ${open?'has-open-card':''}`}>
    <div ref={card} className={`physical-card ${mode} ${className}`} onPointerEnter={enter} onPointerMove={move} onPointerLeave={leave} data-motion-mode={mode} role={open?'dialog':undefined} aria-modal={open||undefined} aria-label={open?label:undefined} onKeyDown={event=>{if(open&&event.key==='Tab'){event.preventDefault();closeButton.current?.focus()}}}>
      <div className="physical-card-rotor"><div className="physical-card-face physical-card-front" aria-hidden={mode==='media-modal'&&open||undefined}>{mode==='media-modal'?<a ref={trigger} href={href} aria-label={label} onClick={launch} onKeyDown={event=>{if(event.key===' ')launch(event)}}>{front}</a>:front}</div><div className="physical-card-face physical-card-back" aria-hidden={mode==='media-modal'&&!open||undefined}>{backContent}</div></div>
    </div>
    {mounted&&open&&createPortal(<div className="physical-card-backdrop" data-testid="media-card-backdrop" onPointerDown={event=>{if(event.target===event.currentTarget)close()}}/>,document.body)}
  </div>;
}
