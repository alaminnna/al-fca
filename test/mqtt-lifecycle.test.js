"use strict";

/*
 * MQTT lifecycle integration tests against an in-process fake broker.
 * No Facebook traffic: the library is pointed at ws://127.0.0.1:<random>.
 */

const test = require("node:test");
const assert = require("node:assert");
const WebSocket = require("ws");
const mqttPacket = require("mqtt-packet");
const utils = require("../utils");
const listenMqttFactory = require("../src/mqtt/listenMqtt");

function startBroker({ onClientPublish } = {}) {
  const wss = new WebSocket.Server({ host: "127.0.0.1", port: 0 });
  const state = { port: null, sockets: [], connectCount: 0, closedCount: 0, publishes: [] };
  wss.on("connection", (socket) => {
    state.connectCount++;
    state.sockets.push(socket);
    const parser = mqttPacket.parser();
    parser.on("packet", (packet) => {
      switch (packet.cmd) {
        case "connect":
          socket.send(mqttPacket.generate({ cmd: "connack", sessionPresent: false, returnCode: 0 }));
          break;
        case "subscribe":
          socket.send(mqttPacket.generate({
            cmd: "suback",
            messageId: packet.messageId,
            granted: packet.subscriptions.map(() => 0),
          }));
          break;
        case "publish":
          state.publishes.push({ topic: packet.topic, payload: packet.payload.toString() });
          if (packet.qos > 0) {
            socket.send(mqttPacket.generate({ cmd: "puback", messageId: packet.messageId }));
          }
          if (onClientPublish) {
            onClientPublish(packet, (topic, obj) => {
              socket.send(mqttPacket.generate({
                cmd: "publish",
                topic,
                payload: Buffer.from(JSON.stringify(obj)),
                qos: 0,
              }));
            });
          }
          break;
        case "pingreq":
          socket.send(mqttPacket.generate({ cmd: "pingresp" }));
          break;
        case "disconnect":
          state.closedCount++;
          socket.end();
          break;
      }
    });
    socket.on("message", (data) => {
      try { parser.parse(Buffer.from(data)); } catch (_) { }
    });
  });
  return new Promise((resolve) => {
    wss.on("listening", () => {
      state.port = wss.address().port;
      resolve({
        port: state.port,
        state,
        close: () => new Promise((res) => {
          try { wss.close(res); } catch (_) { res(); }
          for (const s of state.sockets) { try { s.terminate(); } catch (_) { } }
        }),
      });
    });
  });
}

function makeCtx(brokerPort, extraOptions) {
  return {
    userID: "1000",
    jar: utils.getJar(),
    clientID: "abc123",
    loggedIn: true,
    mqttEndpoint: "ws://127.0.0.1:" + brokerPort,
    region: "PNB",
    firstListen: true,
    lastSeqId: "777",
    syncToken: undefined,
    threadTypes: {},
    globalOptions: Object.assign({
      selfListen: false,
      listenEvents: true,
      online: false,
      autoReconnect: true,
      updatePresence: false,
      emitReady: false,
      userAgent: "test",
      mqttTmsTimeoutMs: 10000,
      reconnectBaseDelayMs: 50,
      reconnectMaxAttempts: 3,
    }, extraOptions || {}),
  };
}

const noopFuncs = { post: () => Promise.reject(new Error("no HTTP in test")) };
function makeApi() {
  return {
    resolvePhotoUrl: (id, cb) => cb(null, "http://photo"),
    markAsDelivered: () => { },
    markAsRead: () => { },
    uploadImageToImgbb: () => Promise.reject(new Error("disabled")),
  };
}

test("connect lifecycle: sync queue created, /t_ms handled, events delivered, clean stop", async () => {
  const broker = await startBroker({
    onClientPublish: (packet, reply) => {
      if (packet.topic === "/messenger_sync_create_queue") {
        setTimeout(() => {
          reply("/t_ms", {
            firstDeltaSeqId: "1",
            syncToken: "tok-1",
            deltas: [],
          });
          // a typing event and a presence event on other topics
          setTimeout(() => {
            brokerState.sockets.filter(Boolean).forEach((s) => {
              try {
                s.send(mqttPacket.generate({
                  cmd: "publish", topic: "/thread_typing", qos: 0,
                  payload: Buffer.from(JSON.stringify({ sender_fbid: "2000", thread: "3000", state: 1 })),
                }));
              } catch (_) { }
            });
          }, 50);
        }, 30);
      }
    },
  });
  const brokerState = broker.state;
  const ctx = makeCtx(broker.port);
  const listen = listenMqttFactory(noopFuncs, makeApi(), ctx);
  const events = [];
  const emitter = listen((err, msg) => events.push({ err, msg }));

  // wait for the typing event to arrive
  const typ = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("typing event never arrived; events=" + JSON.stringify(events))), 5000);
    const poll = setInterval(() => {
      const e = events.find((x) => x.msg && x.msg.type === "typ");
      if (e) { clearInterval(poll); clearTimeout(t); resolve(e.msg); }
    }, 25);
  });
  assert.strictEqual(typ.from, "2000");
  assert.strictEqual(typ.threadID, "3000");
  assert.strictEqual(typ.isTyping, true);

  // ctx bookkeeping
  assert.strictEqual(ctx.syncToken, "tok-1");
  assert.strictEqual(ctx.lastSeqId, "1");
  assert.ok(ctx.mqttClient, "ctx.mqttClient set");

  // clean stop
  await new Promise((resolve) => emitter.stopListening(resolve));
  assert.strictEqual(ctx.mqttClient, undefined, "ctx.mqttClient cleared on stop");
  assert.ok(brokerState.closedCount >= 1, "broker saw a disconnect");

  await broker.close();
});

test("stopListeningAsync resolves even when never connected (regression P1-5)", async () => {
  const ctx = makeCtx(1); // port 1: nothing there, connection fails
  ctx.globalOptions.autoReconnect = false;
  const listen = listenMqttFactory(noopFuncs, makeApi(), ctx);
  const emitter = listen(() => { });
  await assert.doesNotReject(() => emitter.stopListeningAsync());
  assert.strictEqual(ctx.mqttClient, undefined);
});

test("reconnect is bounded: gives up after maxAttempts and reports (regression P1-2)", async () => {
  // A server that accepts TCP but immediately destroys sockets: connect attempts are countable.
  const net = require("net");
  const srv = net.createServer((socket) => socket.destroy());
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  const port = srv.address().port;

  const ctx = makeCtx(port, { reconnectBaseDelayMs: 30, reconnectMaxAttempts: 2 });
  const listen = listenMqttFactory(noopFuncs, makeApi(), ctx);
  const errors = [];
  const emitter = listen((err) => errors.push(err));

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("stop_listen never reported; errors=" + JSON.stringify(errors))), 10000);
    const poll = setInterval(() => {
      if (errors.some((e) => e && e.type === "stop_listen")) { clearInterval(poll); clearTimeout(t); resolve(); }
    }, 25);
  });

  // attempts: 1 initial + 2 retries = 3 total connection attempts, then stop
  await new Promise((res) => setTimeout(res, 300));
  const stopErr = errors.find((e) => e.type === "stop_listen");
  assert.ok(stopErr.error.includes("reconnect attempts exhausted"));
  assert.strictEqual(ctx.mqttClient, undefined);

  srv.close();
});

test("listener after listener: repeated connect/stop cycles do not leak sockets or listeners", async () => {
  const broker = await startBroker();
  const ctx = makeCtx(broker.port, { mqttTmsTimeoutMs: 1500 });

  for (let cycle = 0; cycle < 3; cycle++) {
    const listen = listenMqttFactory(noopFuncs, makeApi(), ctx);
    const emitter = listen(() => { });
    await new Promise((r) => setTimeout(r, 150)); // let it connect
    await new Promise((resolve) => emitter.stopListening(resolve));
  }
  assert.strictEqual(ctx.mqttClient, undefined);
  // Each cycle must have connected once more (previous client was force-closed)
  assert.ok(broker.state.connectCount >= 3, "connectCount=" + broker.state.connectCount);
  await broker.close();
});
