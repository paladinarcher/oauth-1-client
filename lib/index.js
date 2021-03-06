var assert = require('assert');
var OAuth = require('oauth');
var url = require('url');
var Promise = require('promise');
var debug = require('debug')('oauth-1-client');
var request = require('request');

require('extend-error');
var HttpApiError = Error.extend('HttpApiError');

var Client = function(options) {
    assert(options.key, 'Must provide API key');
    assert(options.secret, 'Must provide API secret');
    assert(options.requestUrl, 'Must provide requestUrl');
    assert(options.accessUrl, 'Must provide accessUrl');
    assert(options.apiHostName, 'Must provide apiHostName');

    this.apiKey = options.key;
    this.apiSecret = options.secret;
    this.apiHostName = options.apiHostName;

    // Note: callbackURL is optional here. Can also be provided via extraParams arg to requestToken
    this.callbackURL = options.callbackURL;
    this.method = options.method || 'HMAC-SHA1';
    this.nonceSize = options.nonceSize || 32;
    this.customHeaders = options.customHeaders || {
      "Accept" : "*/*",
      "Connection" : "close",
      "User-Agent" : "Node authentication"
    };
    this.customRequestOptions = options.customRequestOptions || {};

    this.oauthClient = new OAuth.OAuth(
        options.requestUrl,
        options.accessUrl,
        this.apiKey,
        this.apiSecret,
        '1.0',
        this.callbackURL,
        this.method,
        this.nonceSize,
        this.customHeaders,
        this.customRequestOptions);
};

function getCredentials(token, secret, required) {
    var credentials;
    if (typeof token === 'object') {
        credentials = token;
    } else {
        credentials = {
            token: token,
            secret: secret
        };
    }
    if (required) {
        assert(credentials.token, 'Must supply authentication token');
        assert(credentials.secret, 'Must supply authentication secret');
    }
    return credentials;
}

Client.prototype.auth = function(token, secret) {
    var credentials = getCredentials(token, secret);
    var self = this;
    return {
        get: function(path, pageOrQuery) {
            return self.get(path, pageOrQuery, credentials);
        },
        put: function(path, content) {
            return self.put(path, content, credentials);
        },
        post: function(path, content) {
            return self.post(path, content, credentials);
        },
        'delete': function(path) {
            return self['delete'](path, credentials);
        }
    };
};

Client.prototype.get = function(path, pageOrQuery, token, secret) {
    var credentials = getCredentials(token, secret);
    return new Promise(function(resolve, reject) {
        var responseHandler = createResponseHandler(resolve, reject);
        var url;
        if (credentials.token && credentials.secret) {
            url = buildUrl(this.apiKey, this.apiSecret, this.apiHostName, path, pageOrQuery);
            debug('GET (auth):', url);
            this.oauthClient.get(url, credentials.token, credentials.secret, responseHandler);
        } else {
            url = buildUrl(this.apiKey, null, this.apiHostName, path, pageOrQuery);
            debug('GET (unauth):', url);
            request({
                uri: url,
                method: 'GET'
            }, function(err, res, body) {
                responseHandler(err, body, res);
            }.bind(this));
        }
    }.bind(this));
};

Client.prototype.put = function(path, content, token, secret) {
    var credentials = getCredentials(token, secret, true);
    var url = buildUrl(this.apiKey, this.apiSecret, this.apiHostName, path);
    var content_type = null;
    if(this.customHeaders["Content-Type"]) {
      content_type = this.customHeaders["Content-Type"];
    }
    return new Promise(function(resolve, reject) {
        var responseHandler = createResponseHandler(resolve, reject);
        debug('PUT:', url);
        this.oauthClient.put(url, credentials.token, credentials.secret, content, content_type, responseHandler);
    }.bind(this));
};

Client.prototype.post = function(path, content, token, secret) {
    var credentials = getCredentials(token, secret, true);
    var url = buildUrl(this.apiKey, this.apiSecret, this.apiHostName, path);
    var content_type = null;
    if(this.customHeaders["Content-Type"]) {
      content_type = this.customHeaders["Content-Type"];
    }
    return new Promise(function(resolve, reject) {
        var responseHandler = createResponseHandler(resolve, reject);
        debug('POST:', url);
        this.oauthClient.post(url, credentials.token, credentials.secret, content, content_type, responseHandler);
    }.bind(this));
};

Client.prototype['delete'] = function(path, token, secret) {
    var credentials = getCredentials(token, secret, true);
    var url = buildUrl(this.apiKey, this.apiSecret, this.apiHostName, path);
    var content_type = null;
    if(this.customHeaders["Content-Type"]) {
      content_type = this.customHeaders["Content-Type"];
    }
    return new Promise(function(resolve, reject) {
        var responseHandler = createResponseHandler(resolve, reject);
        debug('DELETE:', url);
        this.oauthClient['delete'](url, credentials.token, credentials.secret, content_type, responseHandler);
    }.bind(this));
};

Client.prototype.requestToken = function(extraParams) {
    return new Promise(function(resolve, reject) {
        this.oauthClient.getOAuthRequestToken(extraParams || {}, function(err, oauthToken, oauthTokenSecret, parsedQueryString) {
            if (err) {
                return reject(err);
            }
            resolve({
                token: oauthToken,
                tokenSecret: oauthTokenSecret,
                authorizeUrl: parsedQueryString.login_url,
                query: parsedQueryString
            });
        });
    }.bind(this));
};

Client.prototype.accessToken = function(token, secret, verifier) {
    return new Promise(function(resolve, reject) {
        this.oauthClient.getOAuthAccessToken(token, secret, verifier, function (err, oauthAccessToken, oauthAccessTokenSecret, parsedQueryString) {
            if (err) {
                return reject(err);
            }
            resolve({
                token: oauthAccessToken,
                tokenSecret: oauthAccessTokenSecret,
                query: parsedQueryString
            });
        });
    }.bind(this));
};

function createResponseHandler(resolve, reject) {
    return function responseHandler(err, data, res) {
        if (err) {
            // patch the error returned from oauth lib to add headers (can include important info like request IDs)
            if (res && res.headers) {
                err.headers = res.headers;
            }
            return reject(err);
        }
        if (res.statusCode.toString()[0] !== '2') {
            return reject(new HttpApiError({ statusCode: res.statusCode, body: data }));
        }
        if (typeof data === 'string') {
            try {
                var parsedBody = JSON.parse(data || '{}');
                resolve({
                    statusCode: res.statusCode,
                    body: parsedBody,
                    headers: res.headers
                });
            } catch (err) {
                reject('Error parsing JSON response from API. Error:' + err);
            }
        }
    };
}

function buildUrl(apiKey, apiSecret, apiHostName, path, pageOrQuery) {
    if (apiHostName === null) {
        throw new Error('Must provide apiHostName');
    }
    if (path === null) {
        throw new Error('Must provide a path');
    }
    var query = (pageOrQuery && typeof pageOrQuery === 'object')
        ? pageOrQuery
        : {};
    if (apiKey && !apiSecret) {
        query.api_key = apiKey;
    }
    return url.format({
        protocol: "https:",
        hostname: apiHostName,
        pathname: path,
        query: query
    });
}

module.exports = Client;