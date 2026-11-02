import { describe, expect, it } from 'vitest';
import {
  AUTH_METHODS,
  AUTH_TYPES,
  type AuthType,
  getAuthMethods,
  isAuthTypeValid,
  isRegionOptional,
} from '@/components/modals/connect/authMethods';

describe('authMethods', () => {
  it('knows the ten authentication methods', () => {
    expect(AUTH_TYPES).toHaveLength(10);
    expect(Object.keys(AUTH_METHODS).sort()).toEqual([...AUTH_TYPES].sort());
  });

  it.each([
    ['aws', ['static', 'sharedProfile', 'assumeRole', 'sso', 'defaultChain', 'anonymous']],
    ['minio', ['static', 'anonymous', 'minioAssumeRole', 'minioLdap', 'minioOidc', 'minioCert']],
    ['other', []],
  ])('offers the enabled methods of %s', (provider, expected) => {
    expect(getAuthMethods(provider)).toEqual(expected);
  });

  it.each([
    ['aws', 'static', true],
    ['minio', 'static', true],
    ['aws', 'sso', true],
    ['minio', 'sso', false],
    ['aws', 'anonymous', true],
    ['aws', 'minioLdap', false],
    ['minio', 'anonymous', true],
    ['minio', 'minioLdap', true],
    ['minio', 'minioOidc', true],
    ['minio', 'minioCert', true],
    ['aws', 'minioOidc', false],
    ['aws', 'minioCert', false],
    ['aws', 'unknown', false],
  ])('isAuthTypeValid(%s, %s) is %s', (provider, authType, expected) => {
    expect(isAuthTypeValid(provider, authType)).toBe(expected);
  });

  it.each([
    ['static', true],
    ['minioLdap', true],
    ['minioOidc', false],
    ['minioCert', true],
  ])('autoConnect of %s is %s', (authType, expected) => {
    expect(AUTH_METHODS[authType as AuthType].autoConnect).toBe(expected);
  });

  it.each([
    ['aws', 'static', false],
    ['aws', 'assumeRole', false],
    ['aws', 'sharedProfile', true],
    ['aws', 'sso', true],
    ['aws', 'defaultChain', true],
    ['minio', 'defaultChain', false],
    ['aws', 'nope', false],
  ])('isRegionOptional(%s, %s) is %s', (provider, authType, expected) => {
    expect(isRegionOptional(provider, authType as AuthType)).toBe(expected);
  });
});
