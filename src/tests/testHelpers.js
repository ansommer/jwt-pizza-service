const { DB, Role } = require('../database/database');
const { setAuth } = require('../routes/authRouter');

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

async function createAdminUser() {
  const password = 'toomanysecrets';
  const user = await DB.addUser({
    name: randomName(),
    email: `${randomName()}@admin.com`,
    password,
    roles: [{ role: Role.Admin }],
  });
  return { ...user, password };
}

async function createDinerUser() {
  const password = 'diner-password';
  const user = await DB.addUser({
    name: randomName(),
    email: `${randomName()}@diner.com`,
    password,
    roles: [{ role: Role.Diner }],
  });
  return { ...user, password };
}

async function authenticateUser(user) {
  return setAuth(user);
}

module.exports = { randomName, createAdminUser, createDinerUser, authenticateUser };
