const request = require("supertest");
const app = require("../service");
const { DB } = require("../database/database");
const {
  createAdminUser,
  createDinerUser,
  authenticateUser,
  randomName,
} = require("./testHelpers");

const originalFetch = global.fetch;
let diner;
let dinerToken;
let adminToken;
let franchise;
let store;
let menuItem;

beforeAll(async () => {
  diner = await createDinerUser();
  dinerToken = await authenticateUser(diner);
  const admin = await createAdminUser();
  adminToken = await authenticateUser(admin);

  franchise = await DB.createFranchise({
    name: randomName(),
    admins: [{ email: admin.email }],
  });
  store = await DB.createStore(franchise.id, { name: randomName() });
  menuItem = await DB.addMenuItem({
    title: randomName(),
    description: "Test pizza",
    image: "test.png",
    price: 1,
  });
});

afterAll(() => {
  global.fetch = originalFetch;
});

test("lists the menu and restricts menu updates to admins", async () => {
  const menu = await request(app).get("/api/order/menu");
  expect(menu.status).toBe(200);
  expect(menu.body.some((item) => item.id === menuItem.id)).toBe(true);

  const unauthorized = await request(app).put("/api/order/menu").send({});
  expect(unauthorized.status).toBe(401);

  const forbidden = await request(app)
    .put("/api/order/menu")
    .set("Authorization", `Bearer ${dinerToken}`)
    .send({});
  expect(forbidden.status).toBe(403);

  const title = randomName();
  const added = await request(app)
    .put("/api/order/menu")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      title,
      description: "Added by admin",
      image: "admin.png",
      price: 2,
    });
  expect(added.status).toBe(200);
  expect(added.body.some((item) => item.title === title)).toBe(true);
});

test("lists orders and handles successful and failed factory fulfillment", async () => {
  const unauthorized = await request(app).get("/api/order");
  expect(unauthorized.status).toBe(401);

  const orders = await request(app)
    .get("/api/order")
    .set("Authorization", `Bearer ${dinerToken}`);
  expect(orders.status).toBe(200);
  expect(orders.body.dinerId).toBe(diner.id);

  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reportUrl: "/report", jwt: "factory-jwt" }),
    })
    .mockResolvedValueOnce({
      ok: false,
      json: async () => ({ reportUrl: "/failed-report" }),
    });

  const order = {
    franchiseId: franchise.id,
    storeId: store.id,
    items: [
      {
        menuId: menuItem.id,
        description: menuItem.description,
        price: menuItem.price,
      },
    ],
  };

  const fulfilled = await request(app)
    .post("/api/order")
    .set("Authorization", `Bearer ${dinerToken}`)
    .send(order);
  expect(fulfilled.status).toBe(200);
  expect(fulfilled.body.jwt).toBe("factory-jwt");

  const rejected = await request(app)
    .post("/api/order")
    .set("Authorization", `Bearer ${dinerToken}`)
    .send(order);
  expect(rejected.status).toBe(500);
  expect(rejected.body.followLinkToEndChaos).toBe("/failed-report");
});
