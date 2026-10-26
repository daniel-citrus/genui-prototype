/** The subset of a pino/Fastify logger the server uses. `req.log` satisfies it. */
export interface Logger {
  info(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}
