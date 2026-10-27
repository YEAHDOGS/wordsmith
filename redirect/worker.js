// Short domains (ws., word., smith.dogs.red) answer with a permanent redirect to the one real address, keeping the
// path and query. A separate Worker, not the app: the app serves its static assets without running any code, so it
// can't redirect them, and OAuth callbacks only work on wordsmith.dogs.red.
const CANONICAL_ORIGIN = 'https://wordsmith.dogs.red';
// 308 keeps the method and body, so a stray POST to a short domain isn't turned into a GET.
const PERMANENT_REDIRECT = 308;

export default {
  /** @param {Request} request */
  fetch(request) {
    const { pathname, search } = new URL(request.url);
    return Response.redirect(`${CANONICAL_ORIGIN}${pathname}${search}`, PERMANENT_REDIRECT);
  },
};
