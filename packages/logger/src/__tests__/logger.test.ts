import { Logger, createLogger } from '../index.js';

// Mock console methods
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

describe('Logger', () => {
  let consoleLogMock: jest.Mock;
  let consoleWarnMock: jest.Mock;
  let consoleErrorMock: jest.Mock;

  beforeEach(() => {
    // Mock console methods
    consoleLogMock = jest.fn();
    consoleWarnMock = jest.fn();
    consoleErrorMock = jest.fn();

    console.log = consoleLogMock as any;
    console.warn = consoleWarnMock as any;
    console.error = consoleErrorMock as any;
  });

  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });

  describe('constructor', () => {
    it('should create logger with default configuration', () => {
      const logger = new Logger();

      expect(logger.getLogLevel()).toBe('info');
      expect(logger.getAppName()).toBe('unknown');
      expect(logger.isFileLoggingEnabled()).toBe(true);
    });

    it('should create logger with custom configuration', () => {
      const logger = new Logger({
        logLevel: 'debug',
        appName: 'test-app',
        consoleLogging: true,
        fileLogging: false,
      });

      expect(logger.getLogLevel()).toBe('debug');
      expect(logger.getAppName()).toBe('test-app');
      expect(logger.isFileLoggingEnabled()).toBe(false);
    });
  });

  describe('log levels', () => {
    it('should respect minimum log level - info', () => {
      const logger = new Logger({ logLevel: 'info', fileLogging: false });

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      // Debug should not be logged, others should
      expect(consoleLogMock).toHaveBeenCalledTimes(1); // info only
      expect(consoleWarnMock).toHaveBeenCalledTimes(1); // warn
      expect(consoleErrorMock).toHaveBeenCalledTimes(1); // error
    });

    it('should respect minimum log level - warn', () => {
      const logger = new Logger({ logLevel: 'warn', fileLogging: false });

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      // Only warn and error should be logged
      expect(consoleLogMock).toHaveBeenCalledTimes(0);
      expect(consoleWarnMock).toHaveBeenCalledTimes(1);
      expect(consoleErrorMock).toHaveBeenCalledTimes(1);
    });

    it('should respect minimum log level - debug', () => {
      const logger = new Logger({ logLevel: 'debug', fileLogging: false });

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      // All should be logged
      expect(consoleLogMock).toHaveBeenCalledTimes(2); // debug and info
      expect(consoleWarnMock).toHaveBeenCalledTimes(1); // warn
      expect(consoleErrorMock).toHaveBeenCalledTimes(1); // error
    });

    it('should respect minimum log level - error', () => {
      const logger = new Logger({ logLevel: 'error', fileLogging: false });

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      // Only error should be logged
      expect(consoleLogMock).toHaveBeenCalledTimes(0);
      expect(consoleWarnMock).toHaveBeenCalledTimes(0);
      expect(consoleErrorMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('console logging', () => {
    it('should log to console when enabled', () => {
      const logger = new Logger({ consoleLogging: true, fileLogging: false });

      logger.info('Test message');

      expect(consoleLogMock).toHaveBeenCalledWith('[INFO] %s', 'Test message', '');
    });

    it('should not log to console when disabled', () => {
      const logger = new Logger({ consoleLogging: false, fileLogging: false });

      logger.info('Test message');

      expect(consoleLogMock).not.toHaveBeenCalled();
    });

    it('should include data in console logs', () => {
      const logger = new Logger({ consoleLogging: true, fileLogging: false });
      const testData = { key: 'value', count: 42 };

      logger.info('Test message', testData);

      expect(consoleLogMock).toHaveBeenCalledWith(
        '[INFO] %s', 'Test message',
        JSON.stringify(testData, null, 2)
      );
    });
  });

  describe('log methods', () => {
    let logger: Logger;

    beforeEach(() => {
      logger = new Logger({ consoleLogging: true, fileLogging: false });
    });

    it('should log debug messages', () => {
      logger.setLogLevel('debug');
      logger.debug('Debug message', { test: true });

      expect(consoleLogMock).toHaveBeenCalledWith(
        '[DEBUG] %s', 'Debug message',
        JSON.stringify({ test: true }, null, 2)
      );
    });

    it('should log info messages', () => {
      logger.info('Info message', { test: true });

      expect(consoleLogMock).toHaveBeenCalledWith(
        '[INFO] %s', 'Info message',
        JSON.stringify({ test: true }, null, 2)
      );
    });

    it('should log warn messages', () => {
      logger.warn('Warn message', { test: true });

      expect(consoleWarnMock).toHaveBeenCalledWith(
        '[WARN] %s', 'Warn message',
        JSON.stringify({ test: true }, null, 2)
      );
    });

    it('should log error messages', () => {
      const error = new Error('Test error');
      logger.error('Error message', error);

      expect(consoleErrorMock).toHaveBeenCalledWith('[ERROR] %s', 'Error message', error);
    });

    it('should handle logging without data', () => {
      logger.info('Simple message');

      expect(consoleLogMock).toHaveBeenCalledWith('[INFO] %s', 'Simple message', '');
    });
  });

  describe('setLogLevel', () => {
    it('should update log level dynamically', () => {
      const logger = new Logger({ logLevel: 'warn', fileLogging: false });

      logger.info('Should not log');
      expect(consoleLogMock).not.toHaveBeenCalled();

      logger.setLogLevel('info');
      logger.info('Should log');
      expect(consoleLogMock).toHaveBeenCalled();
    });
  });

  describe('environment detection', () => {
    it('should detect Node.js environment (not Workers)', () => {
      const logger = new Logger({ fileLogging: false });

      // In Node.js test environment, should not use HTTP logging
      expect(logger.isHttpLoggingEnabled()).toBe(false);
    });
  });

  describe('createLogger factory', () => {
    it('should create logger with app name', () => {
      const logger = createLogger('test-app', { logLevel: 'debug', fileLogging: false });

      expect(logger.getAppName()).toBe('test-app');
      expect(logger.getLogLevel()).toBe('debug');
    });

    it('should create logger with default config', () => {
      const logger = createLogger('my-app');

      expect(logger.getAppName()).toBe('my-app');
      expect(logger.getLogLevel()).toBe('info');
    });
  });

  describe('file logging configuration', () => {
    it('should enable file logging by default', () => {
      const logger = new Logger();

      expect(logger.isFileLoggingEnabled()).toBe(true);
    });

    it('should disable file logging when configured', () => {
      const logger = new Logger({ fileLogging: false });

      expect(logger.isFileLoggingEnabled()).toBe(false);
    });
  });
});
