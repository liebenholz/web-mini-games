import { describe, expect, it } from 'vitest';
import { MAX_ERROR_MESSAGE, parseClientErrorReport, sanitizeErrorMessage } from '../src/clientErrors.js';

const valid = {
  kind: 'js_error',
  message: 'boom',
  game: 'gomoku',
  route: 'room',
  release: 'abc1234',
  platform: 'ios',
};

describe('클라이언트 오류 (docs/specs/client-errors.md)', () => {
  it('CE-03: URL 쿼리와 # 뒤를 지운다', () => {
    expect(sanitizeErrorMessage('failed https://play.example.com/gomoku/r/AB2CD3?x=1#y at x')).toBe(
      'failed https://play.example.com/gomoku/r/XXXXXX at x',
    );
  });

  it('CE-03: 방 코드 모양과 4자리 이상 숫자를 가린다', () => {
    expect(sanitizeErrorMessage('room K7MQ2P closed after 12345ms, code 4003')).toBe(
      'room XXXXXX closed after #ms, code #',
    );
    expect(sanitizeErrorMessage('line 42')).toBe('line 42');
  });

  it('CE-03: 공백을 줄이고 200자에서 자른다. Error와 문자열이 아닌 값도 받는다', () => {
    expect(sanitizeErrorMessage(`a  \n b${'x'.repeat(500)}`)).toHaveLength(MAX_ERROR_MESSAGE);
    expect(sanitizeErrorMessage(new Error('bad thing'))).toBe('bad thing');
    expect(sanitizeErrorMessage(undefined)).toBe('');
  });

  it('CE-05: 올바른 보고는 통과하고 문구를 다시 정리한다', () => {
    expect(parseClientErrorReport({ ...valid, message: 'code 99999' })).toEqual({
      ...valid,
      message: 'code #',
    });
    expect(parseClientErrorReport({ ...valid, game: null })).toMatchObject({ game: null });
  });

  it('CE-05: 모르는 종류, 화면, 기기, 형식이 틀린 game·release는 거부한다', () => {
    for (const bad of [
      { ...valid, kind: 'oops' },
      { ...valid, route: 'admin' },
      { ...valid, platform: 'windows phone' },
      { ...valid, game: '../etc' },
      { ...valid, release: 'v1.0.0' },
      { ...valid, message: 42 },
      { ...valid, message: 'x'.repeat(2001) },
      null,
      [],
      'js_error',
    ]) {
      expect(parseClientErrorReport(bad)).toBeNull();
    }
  });
});
