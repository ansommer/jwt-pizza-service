const request = require('supertest');
const app = require('../service');
const { randomName } = require('./testHelpers');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;

beforeAll(async () => {
  testUser.email = `${randomName()}@test.com`;
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);
});

test('login', async () => {
  const loginRes = await request(app).put('/api/auth').send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = { ...testUser, roles: [{ role: 'diner' }] };
  delete expectedUser.password;
  expect(loginRes.body.user).toMatchObject(expectedUser);
});

test('rejects registration when required fields are missing', async () => {
  const response = await request(app).post('/api/auth').send({ email: `${randomName()}@test.com` });
  expect(response.status).toBe(400);
});

test('logout invalidates the current token', async () => {
  const currentUser = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(currentUser.status).toBe(200);

  const logout = await request(app)
    .delete('/api/auth')
    .set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(logout.status).toBe(200);
  expect(logout.body.message).toBe('logout successful');

  const afterLogout = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(afterLogout.status).toBe(401);
});

test('rejects an invalid token on protected routes', async () => {
  const response = await request(app)
    .get('/api/user/me')
    .set('Authorization', 'Bearer invalid-token');
  expect(response.status).toBe(401);
});

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}