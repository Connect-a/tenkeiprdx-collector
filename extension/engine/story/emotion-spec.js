import { buildSampler } from './tween-sampler.js';

const PARENT_POS = {
  default: [-200, 50],
  head: [0, 100],
  rightMouth: [200, -350],
  leftMouth: [-200, -350],
};

const TABLE = {
  1: {
    name: 'Pleasure',
    parent: 'default',
    sizeDelta: 250,
    seq: [
      { op: 'A', p: 'a', to: 1, dur: 0.25, ease: 'outSine' },
      { op: 'J', p: 'punch', to: 0.1, dur: 0.5, ease: 'outBack' },
      { op: 'J', p: 'rz', to: 10, dur: 0.25, ease: 'outSine' },
      { op: 'J', p: 'rz', to: -10, dur: 0.5, delay: 0.25, ease: 'outSine' },
      { op: 'J', p: 'y', to: 50, dur: 0.5, ease: 'linear' },
      { op: 'J', p: 'a', to: 0, dur: 0.5, delay: 0.25, ease: 'outSine' },
    ],
  },
  2: {
    name: 'Sad',
    parent: 'default',
    sizeDelta: 250,
    imagePos: [0, 50],
    seq: [
      { op: 'A', p: 'a', to: 1, dur: 0.25, ease: 'outSine' },
      { op: 'J', p: 'y', to: 0, dur: 0.5, ease: 'outCubic' },
      { op: 'A', p: 'y', to: -50, dur: 0.5, ease: 'outCubic' },
      { op: 'J', p: 'a', to: 0, dur: 0.5, delay: 0.5, ease: 'outSine' },
    ],
  },
  3: {
    name: 'Angry',
    parent: 'default',
    sizeDelta: 125,
    imageScale: [0, 0],
    seq: [
      { op: 'A', p: 'a', to: 1, dur: 0.25, ease: 'outSine' },
      { op: 'J', p: 's', to: 2, dur: 0.5, ease: 'outBounce' },
      { op: 'J', p: 'a', to: 0, dur: 0.5, delay: 0.25, ease: 'outSine' },
    ],
  },
  4: {
    name: 'Amazing',
    parent: 'default',
    sizeDelta: 125,
    seq: [
      { op: 'A', p: 'a', to: 1, dur: 0.25, ease: 'outSine' },
      { op: 'J', p: 's', to: 2, dur: 0.5, ease: 'outElastic' },
      { op: 'J', p: 'a', to: 0, dur: 0.5, delay: 0.25, ease: 'outSine' },
    ],
  },
  5: {
    name: 'Panicked',
    parent: 'default',
    sizeDelta: 250,
    seq: [
      { op: 'A', p: 'a', to: 1, dur: 0.25, ease: 'outSine' },
      { op: 'J', p: 'x', to: -25, dur: 0.25, ease: 'outSine' },
      { op: 'J', p: 'y', to: 25, dur: 0.25, ease: 'outSine' },
      { op: 'A', p: 'a', to: 0, dur: 0.5, ease: 'outSine' },
    ],
  },
  6: {
    name: 'Shy',
    parent: 'default',
    sizeDelta: 250,
    seq: [
      { op: 'A', p: 'a', to: 1, dur: 0.5, ease: 'outSine' },
      { op: 'A', p: 'a', to: 0, dur: 0.5, ease: 'outSine' },
    ],
  },
  7: {
    name: 'Love',
    parent: 'default',
    sizeDelta: 125,
    imageScale: [0, 0],
    seq: [
      { op: 'A', p: 'a', to: 1, dur: 0.5, ease: 'outSine' },
      { op: 'J', p: 'sx', to: 2, dur: 0.5, ease: 'inOutBack' },
      { op: 'J', p: 'sy', to: 2, dur: 0.5, delay: 0.125, ease: 'inOutBack' },
      { op: 'J', p: 'a', to: 0, dur: 0.5, delay: 0.5, ease: 'outSine' },
    ],
  },
  8: {
    name: 'Question',
    parent: 'default',
    sizeDelta: 125,
    seq: [
      { op: 'A', p: 'a', to: 1, dur: 0.25, ease: 'outSine' },
      { op: 'J', p: 's', to: 2, dur: 0.5, ease: 'outElastic' },
      { op: 'J', p: 'a', to: 0, dur: 0.5, delay: 0.25, ease: 'outSine' },
    ],
  },
  10: {
    name: 'Disorder',
    parent: 'head',
    sizeDelta: 250,
    seq: [
      { op: 'A', p: 'a', to: 1, dur: 0.25, ease: 'outSine' },
      { op: 'J', p: 'rz', to: 20, dur: 0.25, ease: 'outSine' },
      { op: 'A', p: 'a', to: 0.25, dur: 0.25, ease: 'outSine' },
      { op: 'J', p: 'rz', to: 0, dur: 0.25, ease: 'outSine' },
      { op: 'A', p: 'a', to: 1, dur: 0.25, ease: 'outSine' },
      { op: 'J', p: 'rz', to: 20, dur: 0.25, ease: 'outSine' },
      { op: 'A', p: 'a', to: 0, dur: 0.25, ease: 'outSine' },
      { op: 'J', p: 'rz', to: 0, dur: 0.25, ease: 'outSine' },
    ],
  },
  11: {
    name: 'Gloomy',
    parent: 'default',
    sizeDelta: 250,
    imagePos: [0, 50],
    imageScale: [1, 0],
    pivot: [0.5, 1],
    seq: [
      { op: 'A', p: 'a', to: 1, dur: 0.25, ease: 'outSine' },
      { op: 'J', p: 'sy', to: 1, dur: 0.25, ease: 'outSine' },
      { op: 'A', p: 'a', to: 0, dur: 0.3, delay: 0.25, ease: 'inSine' },
      { op: 'J', p: 'sy', to: 0, dur: 0.3, ease: 'inSine' },
    ],
  },
  12: {
    name: 'Idea',
    parent: 'default',
    sizeDelta: 250,
    imagePos: [0, -50],
    imageScale: [0, 0],
    seq: [
      { op: 'A', p: 'a', to: 1, dur: 0.3, ease: 'outSine' },
      { op: 'J', p: 'y', to: 25, dur: 0.3, ease: 'outSine' },
      { op: 'J', p: 's', to: 1, dur: 0.3, ease: 'outBack' },
      { op: 'A', p: 'a', to: 0, dur: 0.5, delay: 0.25, ease: 'inSine' },
    ],
  },
  13: {
    name: 'Sigh',
    parent: 'rightMouth',
    sizeDelta: 190,
    imageScale: [-1, 1],
    seq: [
      { op: 'A', p: 'a', to: 1, dur: 0.25, ease: 'outSine' },
      {
        op: 'A',
        p: 'path',
        pts: [
          [10, -30],
          [25, -60],
          [60, -80],
          [100, -100],
        ],
        dur: 0.5,
        ease: 'outCubic',
      },
      { op: 'J', p: 'a', to: 0, dur: 0.5, ease: 'outSine' },
    ],
  },
  14: {
    name: 'Sigh',
    parent: 'leftMouth',
    sizeDelta: 190,
    seq: [
      { op: 'A', p: 'a', to: 1, dur: 0.25, ease: 'outSine' },
      {
        op: 'A',
        p: 'path',
        pts: [
          [-10, -30],
          [-25, -60],
          [-60, -80],
          [-100, -100],
        ],
        dur: 0.5,
        ease: 'outCubic',
      },
      { op: 'J', p: 'a', to: 0, dur: 0.5, ease: 'outSine' },
    ],
  },
  15: {
    name: 'Trouble',
    parent: 'default',
    sizeDelta: 250,
    seq: [
      { op: 'A', p: 'a', to: 1, dur: 0.25, ease: 'outSine' },
      { op: 'J', p: 'y', to: 50, dur: 0.5, ease: 'outSine' },
      { op: 'A', p: 'a', to: 0, dur: 0.5, ease: 'outSine' },
    ],
  },
  16: {
    name: 'Sparkle',
    parent: 'default',
    sizeDelta: 250,
    imageScale: [0, 0],
    seq: [
      { op: 'A', p: 'a', to: 1, dur: 0.5, ease: 'outSine' },
      { op: 'J', p: 'sx', to: 1, dur: 0.5, ease: 'inOutBack' },
      { op: 'J', p: 'sy', to: 1, dur: 0.5, delay: 0.125, ease: 'inOutBack' },
      { op: 'A', p: 'sx', to: 0.98, dur: 0.15, ease: 'outSine' },
      { op: 'J', p: 'sy', to: 1.02, dur: 0.15, ease: 'outSine' },
      { op: 'A', p: 'sx', to: 1.02, dur: 0.15, ease: 'outSine' },
      { op: 'J', p: 'sy', to: 0.98, dur: 0.15, ease: 'outSine' },
      { op: 'A', p: 'sx', to: 0.98, dur: 0.15, ease: 'outSine' },
      { op: 'J', p: 'sy', to: 1.02, dur: 0.15, ease: 'outSine' },
      { op: 'A', p: 'sx', to: 1.02, dur: 0.15, ease: 'outSine' },
      { op: 'J', p: 'sy', to: 0.98, dur: 0.15, ease: 'outSine' },
      { op: 'J', p: 'a', to: 0, dur: 0.1, ease: 'outSine' },
    ],
  },
  17: {
    name: 'Silence',
    parent: 'default',
    sizeDelta: 250,
    imagePos: [100, 50],
    seq: [
      { op: 'A', p: 'fill', to: 1, dur: 1, ease: 'linear' },
      { op: 'J', p: 'x', to: -150, dur: 1, ease: 'linear' },
      { op: 'A', p: 'a', to: 0, dur: 0.2, ease: 'outSine' },
    ],
  },
  18: {
    name: 'Burn',
    parent: 'default',
    sizeDelta: 250,
    imageScale: [0, 0],
    seq: [
      { op: 'A', p: 'a', to: 1, dur: 0.25, ease: 'outSine' },
      { op: 'J', p: 's', to: 1, dur: 0.5, ease: 'outBounce' },
      { op: 'J', p: 'a', to: 0, dur: 0.5, delay: 0.5, ease: 'outSine' },
    ],
  },
};

const SPECS = {};
for (const [code, entry] of Object.entries(TABLE)) {
  SPECS[code] = {
    spriteName: entry.name,
    parentPos: PARENT_POS[entry.parent],
    sizeDelta: entry.sizeDelta,
    pivot: entry.pivot || [0.5, 0.5],
    sampler: buildSampler(entry.seq, { pos: entry.imagePos || [0, 0], scale: entry.imageScale || [1, 1] }),
  };
}

export const emotionSpec = (code) => SPECS[code] || null;
