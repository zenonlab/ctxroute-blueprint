import {describe,expect,it} from 'vitest';
import {flipAxis,motionDuration,pointInRect} from './card-motion';

describe('physical card motion',()=>{
  it('chooses an oblique axis from an edge entry',()=>{
    const axis=flipAxis({x:.95,y:.1});
    expect(axis.x).toBeGreaterThan(0);
    expect(axis.y).toBeGreaterThan(1);
    expect(axis.depth).toBeLessThan(.2);
  });
  it('gives the centre a stable vertical axis and depth impulse',()=>{
    expect(flipAxis({x:.5,y:.5})).toEqual({x:0,y:1,depth:1});
  });
  it('derives the return axis from the exit point',()=>{
    expect(flipAxis({x:.1,y:.8})).not.toEqual(flipAxis({x:.9,y:.2}));
  });
  it('clamps pointer coordinates and removes animation for reduced motion',()=>{
    expect(pointInRect(-5,150,{left:0,top:0,width:100,height:100})).toEqual({x:0,y:1});
    expect(motionDuration(true)).toBe(0);
    expect(motionDuration(false)).toBeGreaterThan(0);
  });
});
