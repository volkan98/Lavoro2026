import { describe, it, expect } from 'vitest';
import { safeJsonResponse } from '@/lib/api/client';

describe('safeJsonResponse & OAuth Response Parsing', () => {
  it('1. Handles valid Fetch JSON response', async () => {
    const mockRes = new Response(JSON.stringify({ success: true, email: 'test@example.com' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const result = await safeJsonResponse(mockRes);
    expect(result).toEqual({ success: true, email: 'test@example.com' });
  });

  it('2. Handles already parsed object', async () => {
    const plainObj = { success: true, access_token: 'abc123token' };
    const result = await safeJsonResponse(plainObj);
    expect(result).toEqual(plainObj);
  });

  it('3. Handles text/html response gracefully without throwing s.json is not a function', async () => {
    const htmlRes = new Response('<html><body>502 Bad Gateway</body></html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    });
    const result = await safeJsonResponse(htmlRes);
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain('Risposta non JSON dal server');
  });

  it('4. Handles HTTP 401 error response', async () => {
    const err401Res = new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    const result = await safeJsonResponse(err401Res);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });

  it('5. Handles HTTP 500 internal server error response', async () => {
    const err500Res = new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
    const result = await safeJsonResponse(err500Res);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Internal Server Error');
  });

  it('6. Valid token endpoint response parsing', async () => {
    const tokenRes = new Response(JSON.stringify({
      success: true,
      email: 'user@gmail.com',
      access_token: 'ya29.a0AxM...',
      expires_at: Date.now() + 3600000,
      scopes: ['https://www.googleapis.com/auth/gmail.send']
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await safeJsonResponse(tokenRes);
    expect(result.success).toBe(true);
    expect(result.access_token).toBe('ya29.a0AxM...');
  });

  it('7. Valid exchange endpoint response parsing', async () => {
    const exchangeRes = new Response(JSON.stringify({
      success: true,
      email: 'user@gmail.com',
      access_token: 'ya29.a0AxM...',
      expires_at: Date.now() + 3600000,
      scopes: ['https://www.googleapis.com/auth/gmail.send']
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await safeJsonResponse(exchangeRes);
    expect(result.success).toBe(true);
    expect(result.email).toBe('user@gmail.com');
  });

  it('8. Complete GIS result simulation does not throw .json is not a function when passed to exchange parsing', async () => {
    // Simulating GIS popup callback result object
    const gisPopupResult = { code: '4/0AVHE...' };
    
    // Passing gisPopupResult to safeJsonResponse directly yields object without error
    const handledGis = await safeJsonResponse(gisPopupResult);
    expect(handledGis).toEqual({ code: '4/0AVHE...' });

    // Server exchange fetch response
    const mockExchangeFetch = new Response(JSON.stringify({
      success: true,
      email: 'user@domain.com',
      access_token: 'mock_token',
      expires_at: Date.now() + 3600000
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const exchangeData = await safeJsonResponse(mockExchangeFetch);
    expect(exchangeData.success).toBe(true);
    expect(exchangeData.email).toBe('user@domain.com');
  });
});
