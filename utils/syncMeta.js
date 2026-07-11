/**
 * Shared helper for stamping sync provenance on mutating writes.
 *
 * Pulls the device + client-op identifiers off the incoming request
 * so a controller can write them into row columns (`device_id`,
 * `client_op_id`) for later reconciliation by the front-end sync
 * engine. The body fallback is kept because earlier offline payloads
 * carried the IDs in JSON before the headers were standardised.
 */
function syncMeta(req) {
    const headerDevice = req && req.headers && req.headers['x-device-id'];
    const headerOp = req && req.headers && req.headers['x-client-op-id'];
    const body = (req && req.body) || {};
    return {
        device_id: body.device_id || headerDevice || null,
        client_op_id: body.client_op_id || headerOp || null,
    };
}

module.exports = { syncMeta };
