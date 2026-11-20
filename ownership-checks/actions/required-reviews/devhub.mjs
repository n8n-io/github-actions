export function ownershipSnapshotReader(env, fetcher = fetch) {
  const { DEVHUB_URL: devhubUrl, ACTIONS_ID_TOKEN_REQUEST_URL: tokenUrl, ACTIONS_ID_TOKEN_REQUEST_TOKEN: requestToken } = env;
  if (!devhubUrl || !tokenUrl || !requestToken) return undefined;

  return async (snapshot) => {
    const endpoint = new URL('/api/v1/ci/ownership-snapshot', devhubUrl);
    if (endpoint.protocol !== 'https:') throw new Error('DevHub must use HTTPS');
    const signal = AbortSignal.timeout(2_000);
    const oidcUrl = new URL(tokenUrl);
    oidcUrl.searchParams.set('audience', 'devhub');
    const oidc = await fetcher(oidcUrl, {
      headers: { Authorization: `Bearer ${requestToken}` }, redirect: 'error', signal,
    });
    if (!oidc.ok) return null;
    const { value } = await oidc.json();
    if (!value) return null;
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${value}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
      redirect: 'error',
      signal,
    });
    return response.ok ? response.json() : null;
  };
}
