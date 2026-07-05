/**
 * True only if a Sofi message is a response to OUR OWN command — either a reply
 * to the command message we sent, or a message that @-mentions our user. Sofi
 * always addresses the triggering player ("@you is dropping cards" /
 * "@you Your Drop will be ready…"), so this reliably rejects other players'
 * drops and cooldowns in shared channels.
 *
 * @param {object} message - discord message (uses .reference and .mentions)
 * @param {{ commandMsgId: string|null, selfUserId: string|null }} ctx
 * @returns {boolean}
 */
function isOwnResponse(message, { commandMsgId, selfUserId }) {
  if (!message) return false;
  if (commandMsgId && message.reference && message.reference.messageId === commandMsgId) return true;
  const users = message.mentions && message.mentions.users;
  if (selfUserId && users && typeof users.has === 'function' && users.has(selfUserId)) return true;
  return false;
}

module.exports = { isOwnResponse };
