export type CardPoint={x:number;y:number};
export type FlipAxis={x:number;y:number;depth:number};

const clamp=(value:number)=>Math.max(0,Math.min(1,value));

export function pointInRect(clientX:number,clientY:number,rect:Pick<DOMRect,'left'|'top'|'width'|'height'>):CardPoint{
  return {x:clamp((clientX-rect.left)/Math.max(1,rect.width)),y:clamp((clientY-rect.top)/Math.max(1,rect.height))};
}

export function flipAxis(point:CardPoint):FlipAxis{
  const horizontal=(point.x-.5)*2;
  const vertical=(point.y-.5)*2;
  const edge=Math.min(1,Math.hypot(horizontal,vertical));
  return {x:vertical===0?0:-vertical*.72,y:1+Math.abs(horizontal)*.32,depth:1-edge};
}

export function tiltAt(point:CardPoint){
  return {x:(.5-point.y)*14,y:(point.x-.5)*17,glareX:point.x*100,glareY:point.y*100,shadowX:(.5-point.x)*20};
}

export const motionDuration=(reduced:boolean)=>reduced?0:520;
