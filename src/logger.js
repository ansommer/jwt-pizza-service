const config = require('./config');
const { AsyncLocalStorage } = require('node:async_hooks');

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    if (Buffer.isBuffer(value)) return value.toString();
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /password|token|jwt|secret|authorization|api.?key/i.test(key) ? '*****' : sanitize(entry),
      ]),
    );
  }
  if (typeof value === 'string') {
    return value
      .replace(/("(?:password|token|jwt|secret|authorization|api.?key)"\s*:\s*)"[^"]*"/gi, '$1"*****"')
      .replace(/Bearer\s+\S+/gi, 'Bearer *****');
  }
  return value;
}

class Logger {
  requestContext = new AsyncLocalStorage();

  httpLogger = (req, res, next) => {
    let responseBody;
    const send = res.send;

    res.send = function (body) {
      responseBody = body;
      return send.call(this, body);
    };

    res.on('finish', () => {
      const statusCode = res.statusCode;
      const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
      this.log(level, 'http', {
        method: req.method,
        path: req.originalUrl,
        statusCode,
        authorized: Boolean(req.headers.authorization),
        userId: req.user?.id ?? null,
        reqBody: req.body,
        resBody: responseBody,
      });
    });

    this.requestContext.run({ req }, next);
  };

  log(level, type, logData) {
    const event = {
      streams: [
        {
          stream: { component: config.logging.source, level, type },
          values: [[(Date.now() * 1000000).toString(), JSON.stringify(sanitize(logData))]],
        },
      ],
    };
    this.sendLogToGrafana(event);
  }

  getCurrentUserId() {
    return this.requestContext.getStore()?.req.user?.id ?? null;
  }

  sendLogToGrafana(event) {
    Promise.resolve()
      .then(() => fetch(config.logging.endpointUrl, {
        method: 'POST',
        body: JSON.stringify(event),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.logging.accountId}:${config.logging.apiKey}`,
        },
      }))
      .then((response) => {
        if (response && !response.ok) console.error('Failed to send log to Grafana');
      })
      .catch(() => {
        console.error('Failed to send log to Grafana');
      });
  }
}

module.exports = new Logger();
