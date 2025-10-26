import type { Express } from 'express';

export interface Endpoints {
  bind(app: Express): void;
}
