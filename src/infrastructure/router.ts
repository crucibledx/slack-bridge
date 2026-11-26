import {jsonResponse} from './http'

export type RouteHandler<E> = (request: Request, env: E, ctx: ExecutionContext) => Response | Promise<Response>

/** Path → HTTP method → handler. A new endpoint is one entry here. */
export type Routes<E> = Record<string, Record<string, RouteHandler<E>>>

export function createRouter<E>(routes: Routes<E>): RouteHandler<E> {
  // Maps, so paths such as /__proto__ or methods such as toString never reach Object.prototype.
  const table = new Map(Object.entries(routes).map(([path, methods]) => [path, new Map(Object.entries(methods))]))

  return (request, env, ctx) => {
    const methods = table.get(new URL(request.url).pathname)
    if (!methods) return jsonResponse(404, {ok: false, error: 'not_found'})
    const handler = methods.get(request.method)
    if (!handler) {
      return jsonResponse(405, {ok: false, error: 'method_not_allowed'}, {Allow: [...methods.keys()].join(', ')})
    }
    return handler(request, env, ctx)
  }
}
