/// <reference types="astro/client" />

import type { } from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'hover-tilt': any;
    }
  }
}
