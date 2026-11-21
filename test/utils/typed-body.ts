import { Response } from 'supertest';

/** Casts a supertest response body (typed `any` by design) to a known shape. */
export function typedBody<T>(res: Response): T {
  return res.body as T;
}
