export async function requireRepoWriter(request, repo = 'claimloss-lab/trade-desk') {
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match && match[1].trim();
  if (!token) return { ok: false, status: 401, error: 'GitHub authorization required' };

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'TradeDesk-Authorization',
  };
  try {
    const userRes = await fetch('https://api.github.com/user', { headers });
    if (!userRes.ok) return { ok: false, status: 401, error: 'Invalid GitHub authorization' };
    const user = await userRes.json();
    if (!user || typeof user.login !== 'string' || !user.login) {
      return { ok: false, status: 401, error: 'Invalid GitHub authorization' };
    }

    const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers });
    if (!repoRes.ok) return { ok: false, status: 403, error: 'Cannot verify repository access' };
    const repoData = await repoRes.json();
    if (repoData?.permissions?.push !== true) {
      return { ok: false, status: 403, error: 'GitHub account does not have write access to this repository' };
    }
    return { ok: true, login: user.login };
  } catch {
    return { ok: false, status: 502, error: 'GitHub authorization check failed' };
  }
}
