import request from 'http';
// Lekki integracyjny test — wymaga uruchomienia serwera. Pomijamy domyślnie.
describe.skip('integration: /api/health', () => {
  it('responds 200', (done) => {
    request.get('http://localhost:3000/api/health', (res) => {
      expect(res.statusCode).toBe(200);
      done();
    });
  });
});
