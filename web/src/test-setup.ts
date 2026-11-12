import { expect, vi } from 'vitest';

(globalThis as unknown as { expect: typeof expect; vi: typeof vi }).expect = expect;
(globalThis as unknown as { expect: typeof expect; vi: typeof vi }).vi = vi;