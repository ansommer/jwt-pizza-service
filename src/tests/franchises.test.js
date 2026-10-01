const request = require('supertest');
const app = require('../service');
const { DB } = require('../database/database');
const { createAdminUser, createDinerUser, authenticateUser, randomName } = require('./testHelpers');

let dinerToken;
let admin;
let adminToken;
let franchise;

beforeAll(async () => {
  const diner = await createDinerUser();
  dinerToken = await authenticateUser(diner);
  admin = await createAdminUser();
  adminToken = await authenticateUser(admin);

  franchise = await DB.createFranchise({
    name: randomName(),
    admins: [{ email: admin.email }],
  });
});

test('lists franchises and limits user franchise details to self or admins', async () => {
  const list = await request(app).get(`/api/franchise?name=${franchise.name}`);
  expect(list.status).toBe(200);
  expect(list.body.franchises.some((item) => item.id === franchise.id)).toBe(true);

  const own = await request(app)
    .get(`/api/franchise/${admin.id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(own.status).toBe(200);
  expect(own.body.some((item) => item.id === franchise.id)).toBe(true);

  const other = await request(app)
    .get(`/api/franchise/${admin.id}`)
    .set('Authorization', `Bearer ${dinerToken}`);
  expect(other.status).toBe(200);
  expect(other.body).toEqual([]);
});

test('restricts franchise creation and allows authorized store management', async () => {
  const denied = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({ name: randomName(), admins: [{ email: admin.email }] });
  expect(denied.status).toBe(403);

  const createdName = randomName();
  const created = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: createdName, admins: [{ email: admin.email }] });
  expect(created.status).toBe(200);
  expect(created.body.name).toBe(createdName);

  const storeResponse = await request(app)
    .post(`/api/franchise/${franchise.id}/store`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: randomName() });
  expect(storeResponse.status).toBe(200);

  const deleteStore = await request(app)
    .delete(`/api/franchise/${franchise.id}/store/${storeResponse.body.id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(deleteStore.status).toBe(200);
});

test('requires authentication and deletes a franchise', async () => {
  const target = await DB.createFranchise({
    name: randomName(),
    admins: [{ email: admin.email }],
  });

  const unauthorized = await request(app).delete(`/api/franchise/${target.id}`);
  expect(unauthorized.status).toBe(401);

  const deleted = await request(app)
    .delete(`/api/franchise/${target.id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(deleted.status).toBe(200);
  expect(deleted.body.message).toBe('franchise deleted');
});
