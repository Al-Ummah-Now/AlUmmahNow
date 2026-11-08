// Jest stand-in for @al-ummah-now/openauth/{client,subject,error}. The package
// ships ESM only (its exports map has just the "import" condition), so jest's
// CommonJS resolver cannot load it. This lets modules that import it load under
// jest; a test that exercises auth mocks the client itself.
class InvalidAccessTokenError extends Error {}

function createClient() {
  const unavailable = () => {
    throw new Error('openauth client is not available under jest; mock it in the test')
  }
  return { authorize: unavailable, exchange: unavailable, refresh: unavailable, verify: unavailable }
}

function createSubjects(types) {
  return types
}

module.exports = { createClient, createSubjects, InvalidAccessTokenError }
