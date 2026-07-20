import { Server } from 'http';
import request from 'supertest';

interface LoginResponseBody {
  accessToken: string;
  refreshToken: string;
}

/** Logs in as the seeded admin over the real HTTP login route. */
export async function authAs(httpServer: Server): Promise<string> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  const response = await request(httpServer)
    .post('/api/v1/auth/login')
    .send({ email, password });

  if (response.status !== 200) {
    throw new Error(
      `authAs() login failed with status ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }

  return (response.body as LoginResponseBody).accessToken;
}
