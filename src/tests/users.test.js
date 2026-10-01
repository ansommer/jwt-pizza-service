const request = require('supertest');
const app = require('../service');
const { createAdminUser, createDinerUser, authenticateUser, randomName } = require('./testHelpers');

let diner;
let dinerToken;
let admin;

beforeAll(async () => {
  diner = await createDinerUser();
  dinerToken = await authenticateUser(diner);
  admin = await createAdminUser();
});

test('returns the authenticated user and updates their own profile', async () => {
  const me = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${dinerToken}`);
  expect(me.status).toBe(200);
  expect(me.body.id).toBe(diner.id);

  const newName = randomName();
  const update = await request(app)
    .put(`/api/user/${diner.id}`)
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({ name: newName, email: diner.email });
  expect(update.status).toBe(200);
  expect(update.body.user.name).toBe(newName);
  expect(update.body.token).toBeTruthy();
});

test('prevents a diner from updating another user', async () => {
  const response = await request(app)
    .put(`/api/user/${admin.id}`)
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({ name: 'unauthorized change' });
  expect(response.status).toBe(403);
});
