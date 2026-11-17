const config = require('./config');

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    if (Buffer.isBuffer(value)) return value.toString();
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /password|token|secret|authorization|api.?key/i.test(key) ? '*****' : sanitize(entry),
      ]),
    );
  }
  if (typeof value === 'string') {
    return value
      .replace(/("(?:password|token|secret|authorization|api.?key)"\s*:\s*)"[^"]*"/gi, '$1"*****"')
      .replace(/Bearer\s+\S+/gi, 'Bearer *****');
  }
  return value;
}

class Logger {
  httpLogger = (req, res, next) => {
    const logger = this;
    let responseBody;
    const send = res.send;

    res.send = function (body) {
      responseBody = body;
      return send.call(this, body);
    };

    res.on('finish', () => {
      const statusCode = res.statusCode;
      const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
      logger.log(level, {
        method: req.method,
        path: req.originalUrl,
        statusCode,
        authorized: Boolean(req.headers.authorization),
        userId: req.user?.id ?? null,
        reqBody: req.body,
        resBody: responseBody,
      });
    });

    next();
  }

  log(level, logData) {
    const event = {
      streams: [
        {
          stream: { component: config.logging.source, level, type: 'http' },
          values: [[(Date.now() * 1000000).toString(), JSON.stringify(sanitize(logData))]],
        },
      ],
    };
    this.sendLogToGrafana(event);
  }

  sendLogToGrafana(event) {
    fetch(config.logging.endpointUrl, {
      method: 'POST',
      body: JSON.stringify(event),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.logging.accountId}:${config.logging.apiKey}`,
      },
    }).then((response) => {
      if (!response.ok) console.error('Failed to send log to Grafana');
    }).catch(() => {
      console.error('Failed to send log to Grafana');
    });
  }
}

module.exports = new Logger();
