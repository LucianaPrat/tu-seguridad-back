import { Server } from 'http';
import request from 'supertest';

interface LoginResponseBody {
  accessToken: string;
}

/** Logs in as the seeded admin over the real HTTP login route. */
export function authAs(httpServer: Server): Promise<string> {
  return loginAs(
    httpServer,
    process.env.ADMIN_EMAIL ?? '',
    process.env.ADMIN_PASSWORD ?? '',
  );
}

/** Logs in as any seeded account; the token carries that account's space. */
export async function loginAs(
  httpServer: Server,
  email: string,
  password: string,
): Promise<string> {
  const response = await request(httpServer)
    .post('/api/v1/auth/login')
    .send({ email, password });

  if (response.status !== 200) {
    throw new Error(
      `loginAs(${email}) failed with status ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }

  return (response.body as LoginResponseBody).accessToken;
}
