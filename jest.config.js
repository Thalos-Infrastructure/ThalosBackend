module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // Belt-and-suspenders: the load suite lives outside src/ and is *.js, so Jest
  // already ignores it, but make the exclusion explicit so it never joins CI.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/../test/load/'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
