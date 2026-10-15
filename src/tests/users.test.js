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

test('list users unauthorized', async () => {
  const listUsersRes = await request(app).get('/api/user');
  expect(listUsersRes.status).toBe(401);
});

test('list users', async () => {
  const [user, userToken] = await registerUser(request(app), `pizza-${randomName()}`);
  const listUsersRes = await request(app)
    .get(`/api/user?page=1&limit=10&name=${encodeURIComponent(user.name)}`)
    .set('Authorization', 'Bearer ' + userToken);
  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body.users).toHaveLength(1);
  expect(listUsersRes.body.users[0]).toMatchObject({
    id: user.id,
    name: user.name,
    email: user.email,
    roles: [{ role: 'diner' }],
  });
  expect(listUsersRes.body.users[0]).not.toHaveProperty('password');
  expect(listUsersRes.body.more).toBe(false);
});

test('list users supports pagination and wildcard name filtering', async () => {
  const namePrefix = `pizza-${randomName()}`;
  const [firstUser, userToken] = await registerUser(request(app), `${namePrefix}-first`);
  const [secondUser] = await registerUser(request(app), `${namePrefix}-second`);
  const nameFilter = encodeURIComponent(`${namePrefix}-*`);

  const firstPage = await request(app)
    .get(`/api/user?page=1&limit=1&name=${nameFilter}`)
    .set('Authorization', `Bearer ${userToken}`);
  expect(firstPage.status).toBe(200);
  expect(firstPage.body.users.map((listedUser) => listedUser.id)).toEqual([firstUser.id]);
  expect(firstPage.body.more).toBe(true);

  const secondPage = await request(app)
    .get(`/api/user?page=2&limit=1&name=${nameFilter}`)
    .set('Authorization', `Bearer ${userToken}`);
  expect(secondPage.status).toBe(200);
  expect(secondPage.body.users.map((listedUser) => listedUser.id)).toEqual([secondUser.id]);
  expect(secondPage.body.more).toBe(false);
});

async function registerUser(service, name = 'pizza diner') {
  const testUser = {
    name,
    email: `${randomName()}@test.com`,
    password: 'a',
  };
  const registerRes = await service.post('/api/auth').send(testUser);
  registerRes.body.user.password = testUser.password;

  return [registerRes.body.user, registerRes.body.token];
}

test('delete a user', async () => {
  const admin = await createAdminUser();
  const adminToken = await authenticateUser(admin);

  const response = await request(app)
    .delete(`/api/user/${diner.id}`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(response.status).toBe(200);
  expect(response.body.message).toBe('user deleted');
});

test('delete users unauthorized', async () => {
  const deleteUserResponse = await request(app)
    .delete(`/api/user/${diner.id}`);
  expect(deleteUserResponse.status).toBe(401);
});
