import { JSONRPCClient, JSONRPCErrorException } from "json-rpc-2.0";

import { formatApiCall } from "utils/proxy/api-helpers";
import { httpProxy } from "utils/proxy/http";
import getServiceWidget from "utils/config/service-helpers";
import createLogger from "utils/logger";
import widgets from "widgets/widgets";

const logger = createLogger("jsonrpcProxyHandler");

export async function sendJsonRpcRequest(url, method, params, username, password) {
  const headers = {
    "content-type": "application/json",
    "accept": "application/json"
  }

  if (username && password) {
    const authorization = Buffer.from(`${username}:${password}`).toString("base64");
    headers.authorization = `Basic ${authorization}`;
  }

  const client = new JSONRPCClient(async (rpcRequest) => {
    const httpRequestParams = {
      method: "POST",
      headers,
      body: JSON.stringify(rpcRequest)
    };

    // eslint-disable-next-line no-unused-vars
    const [status, contentType, data] = await httpProxy(url, httpRequestParams);
    const dataString = data.toString();
    if (status === 200) {
      const json = JSON.parse(dataString);

      // in order to get access to the underlying error object in the JSON response
      // you must set `result` equal to undefined
      if (json.error && (json.result === null)) {
        json.result = undefined;
      }
      return client.receive(json);
    }

    return Promise.reject(new Error(dataString));
  });

  try {
    const response = await client.request(method, params);
    return [200, "application/json", JSON.stringify(response)];
  }
  catch (e) {
    if (e instanceof JSONRPCErrorException) {
      return [200, "application/json", JSON.stringify({result: null, error: {code: e.code, message: e.message}})];
    }

    logger.warn("Error calling JSONPRC endpoint: %s.  %s", url, e);
    return [500, "application/json", JSON.stringify({result: null, error: {code: 2, message: e.toString()}})];
  }
}

export default async function jsonrpcProxyHandler(req, res) {
  const { group, service, endpoint: method } = req.query;

  if (group && service) {
    const widget = await getServiceWidget(group, service);
    const api = widgets?.[widget.type]?.api;

    if (!api) {
      return res.status(403).json({ error: "Service does not support API calls" });
    }

    if (widget) {
      const url = formatApiCall(api, { ...widget });

      // eslint-disable-next-line no-unused-vars
      const [status, contentType, data] = await sendJsonRpcRequest(url, method, null, widget.username, widget.password);
      res.status(status).end(data);
    }
  }

  logger.debug("Invalid or missing proxy service type '%s' in group '%s'", service, group);
  return res.status(400).json({ error: "Invalid proxy service type" });
}
