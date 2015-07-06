goog.require('config');
goog.require('goog.json'); // jshint unused:false

/* globals branch_sample_key, session_id, identity_id, browser_fingerprint_id, branch */

describe('Integration tests', function() {
	var requests = [ ], xhr, clock, jsonpCallback = 0;

	var clearBranchStorage = function() {
		sessionStorage.clear();
		localStorage.clear();
		var clearCookies = function(temp, perm) {
			var deleteCookie = function(cookie) {
				document.cookie = cookie.substring(0, cookie.indexOf('=')) + "=;expires=-1;path=/";
			};
			var cookieArray = document.cookie.split(';');
			for (var i = 0; i < cookieArray.length; i++) {
				var cookie = cookieArray[i];
				while (cookie.charAt(0) == ' ') { cookie = cookie.substring(1, cookie.length); }
				if (cookie.indexOf("BRANCH_WEBSDK_COOKIE") == 0) {
					if (temp && cookie.indexOf("branch_expiration_date=") == -1) { deleteCookie(cookie); }
					else if (perm && cookie.indexOf("branch_expiration_date=") > 0) { deleteCookie(cookie); }
				}
			}
		};
		clearCookies(true, true);
		branch._storage._store = { };
	};

	before(function() {
		xhr = sinon.useFakeXMLHttpRequest();
		clock = sinon.useFakeTimers();
		xhr.onCreate = function(xhr) { requests.push(xhr); };
		if (window.WEB_BUILD) {
			sinon.stub(branch._server, "createScript", function(src) {
				requests.push({ src: src, callback: window[src.match(/callback=([^&]+)/)[1]] });
			});
		}
		else if (window.CORDOVA_BUILD && cordova) {
			sinon.stub(cordova, "require", function() {
				return function() { arguments[0]({ }); }
			});
		}

	});

	beforeEach(function() {
		clearBranchStorage();
		testUtils.go('');
		branch.identity_id = identity_id.toString();
		branch.device_fingerprint_id = identity_id.toString();
	});

	afterEach(function() {
		jsonpCallback++;
		requests = [];
	});

	after(function() {
		if (window.WEB_BUILD) { branch._server.createScript.restore(); }
		else if (window.CORDOVA_BUILD && cordova) { cordova.require.restore(); }
		xhr.restore();
		clock.restore();
	});

	var sampleParams = {
		tags: [ 'tag1', 'tag2' ],
		channel: 'sample app',
		feature: 'create link',
		stage: 'created link',
		type: 1,
		data: {
			mydata: 'bar',
			'$desktop_url': 'https://cdn.branch.io/example.html',
			'$og_title': 'Branch Metrics',
			'$og_description': 'Branch Metrics',
			'$og_image_url': 'http://branch.io/img/logo_icon_white.png'
		}
	};

	var indexOfLastInitRequest = function(requestsAfterInit) {
		return requestsAfterInit + (window.CORDOVA_BUILD ? 0 : 1);
	};

	var numberOfAsserts = function(assertsAfterInit) {
		return assertsAfterInit + (window.CORDOVA_BUILD ? 2 : 4);
	};

	var branchInit = function(assert, callback) {
		branch.init.apply(branch, window.CORDOVA_BUILD ? [ device_fingerprint_id, { isReferrable: true }, callback ] : [ device_fingerprint_id, callback ]);
		if (window.CORDOVA_BUILD) {
			requests[0].respond(200,
					{ "Content-Type": "application/json" },
					'{ "identity_id":' + identity_id + ', "session_id":"123088518049178533", "device_fingerprint_id":"79336952217731267", "browser_fingerprint_id":null, "link":"https://bnc.lt/i/4LYQTXE0_k", "identity":"Branch","has_app":true }');
			if (assert) {
				assert.equal(requests.length, 1);
				assert.equal(requests[0].requestBody, 'sdk=cordova' + config.version + '&app_id=' + device_fingerprint_id);
			}
		}
		else {
			if (assert) {
				assert.equal(requests.length, 1);
				assert.equal(requests[0].src, 'https://bnc.lt/_r?sdk=web' + config.version + '&callback=branch_callback__' + jsonpCallback.toString());
			}
			requests[0].callback(browser_fingerprint_id);
			requests[1].respond(200,
					{ "Content-Type": "application/json" },
					'{ "identity_id":' + identity_id + ', "session_id":"123088518049178533", "device_fingerprint_id":null, "browser_fingerprint_id":"79336952217731267", "link":"https://bnc.lt/i/4LYQTXE0_k", "identity":"Branch","has_app":true }');
			if (assert) {
				assert.equal(requests.length, 2);
				assert.equal(requests[1].requestBody, 'identity_id=' + identity_id + '&is_referrable=1&sdk=web' + config.version + '&browser_fingerprint_id=' + browser_fingerprint_id + '&app_id=' + browser_fingerprint_id);
			}
		}
	};

	describe('init', function() {
		it('should call api with params and version', function(done) {
			var assert = testUtils.plan(numberOfAsserts(1), done);
			branchInit(assert, function(err, data) {
				assert.deepEqual(data,
					{
						data: null,
						referring_identity: null,
						identity: "Branch",
						has_app: true,
						referring_link: null
					},
					'Expected response returned');
			});
		});

		it('should support being called without a callback', function(done) {
			var assert = testUtils.plan(numberOfAsserts(0), done);
			branchInit(assert);
		});

		it('should return error to callback', function(done) {
			var assert = testUtils.plan(1, done);
			branch.init(browser_fingerprint_id, function(err) {
				jsonpCallback--;
				assert.equal(err.message, 'Error in API: 400');
			});
			if (window.CORDOVA_BUILD) { requests[indexOfLastInitRequest(0)].respond(400); }
			else {
				requests[0].callback(browser_fingerprint_id);
				requests[1].respond(400);
			}
		});

		it('should attempt 5xx error three times total', function(done) {
			var assert = testUtils.plan(1, done);
			branch.init(browser_fingerprint_id, function(err) {
				assert.equal(err.message, 'Error in API: 500');
			});
			var request_count = 0;
			if (window.WEB_BUILD) {
				requests[request_count].callback(browser_fingerprint_id);
				request_count++;
			}
			requests[request_count].respond(500);
			clock.tick(250);
			request_count++
			requests[request_count].respond(500);
			clock.tick(250);
			request_count++
			requests[request_count].respond(500);
		});

		it('should store in session and call open with link_identifier from hash', function(done) {
			var assert = testUtils.plan(1, done);
			if (testUtils.go("#r:12345")) {
				branchInit();
				assert.equal(true, requests[indexOfLastInitRequest(1)].requestBody.indexOf('link_identifier=12345') > -1);
			} else { done(); }

		});
	});

	describe('setIdentity', function() {
		it('make two requests to init and set identity, and return expected data', function(done) {
			var assert = testUtils.plan(2, done);
			branchInit();
			branch.setIdentity('identity', function(err, data) {
				assert.deepEqual(data,
					{
						"identity_id": identity_id,
						"link_click_id":"114750153298026746",
						"link":"https://bnc.lt/i/4LYQTXE0_k",
						"referring_data_parsed": null
					},
					'Expected response returned'
				);
			});
			assert.equal(requests.length, indexOfLastInitRequest(2));
			requests[indexOfLastInitRequest(1)].respond(200,
				{ "Content-Type": "application/json" },
				'{ "identity_id":' + identity_id + ', "link_click_id":"114750153298026746", "link":"https://bnc.lt/i/4LYQTXE0_k" }');
		});
	});

	describe('data', function() {
		it('should make two requests and return session data', function(done) {
			var assert = testUtils.plan(numberOfAsserts(2), done);
			branchInit(assert);
			branch.data(function(err, data) {
				assert.deepEqual(data,
					{
						data: null,
						referring_identity: null,
						identity: "Branch",
						has_app: true,
						referring_link: null
					});
			});
			assert.equal(requests.length, indexOfLastInitRequest(1));
		});
	});

	if (window.CORDOVA_BUILD) {
		describe('first', function() {
			it('should make two requests and return first session data', function(done) {
				var assert = testUtils.plan(numberOfAsserts(2), done);
				branchInit(assert);
				branch.first(function(err, data) {
					assert.deepEqual(data,
						{
							data: null,
							referring_identity: null,
							identity: "Branch",
							has_app: true,
							referring_link: null
						});
				});
				assert.equal(requests.length, indexOfLastInitRequest(1));
			});
		});

		describe('close', function() {
			it('should make two requests and close session', function(done) {
				var assert = testUtils.plan(numberOfAsserts(2), done);
				branchInit(assert);
				branch.close(function(err) {
					assert.equal(err, null);
				});
				assert.equal(requests.length, indexOfLastInitRequest(2));
				requests[indexOfLastInitRequest(1)].respond(200);
			});
		});
	}

	describe('logout', function() {
		it('should make two requests and logout session', function(done) {
			var assert = testUtils.plan(numberOfAsserts(2), done);
			branchInit(assert);
			branch.logout(function(err) {
				assert.equal(err, null);
			});
			assert.equal(requests.length, indexOfLastInitRequest(2));
			requests[indexOfLastInitRequest(1)].respond(200,
				{ "Content-Type": "application/json" },
				'{"session_id":"124235352855552203","identity_id":' + identity_id + ',"link":"https://bnc.lt/i/4tLqIdk017"}');
		});
	});

	describe('track', function() {
		it('should make two requests and return undefined, no metadata', function(done) {
			var assert = testUtils.plan(numberOfAsserts(2), done);
			branchInit(assert);
			branch.track('track', { }, function(err, data) {
				assert.equal(data, undefined);
			});
			assert.equal(requests.length, indexOfLastInitRequest(2));
			requests[indexOfLastInitRequest(1)].respond(200,
				{ "Content-Type": "application/json" },
				'{ }');
		});

		it('should make two requests and return undefined, with metadata', function(done) {
			var assert = testUtils.plan(numberOfAsserts(2), done);
			var testMetadata = { "test": "meta_data" };
			branchInit(assert);
			branch.track('track', testMetadata, function(err, data) {
				assert.equal(data, undefined);
			});
			assert.equal(requests.length, indexOfLastInitRequest(2));
			requests[indexOfLastInitRequest(1)].respond(200,
				{ "Content-Type": "application/json" },
				JSON.stringify(testMetadata));
		});
	});

	describe('link', function() {
		it('should make three requests and return short link', function(done) {
			var assert = testUtils.plan(numberOfAsserts(2), done);
			branchInit(assert);
			branch.link(sampleParams, function(err, data) {
				assert.equal(data, "https://bnc.lt/l/4manXlk0AJ");
			});
			assert.equal(requests.length, indexOfLastInitRequest(2));
			requests[indexOfLastInitRequest(1)].respond(200,
				{ "Content-Type": "application/json" },
				'{ "url":"https://bnc.lt/l/4manXlk0AJ" }');
		});
	});

	describe('referrals', function() {
		it('should make three requests and return referral data', function(done) {
			var assert = testUtils.plan(numberOfAsserts(2), done);
			var expectedResponse = { "install": { "total": 5, "unique": 2 }, "open": { "total": 4, "unique": 3 }, "buy": { "total": 7, "unique": 3 } };
			branchInit(assert);
			branch.referrals(function(err, data) {
				assert.deepEqual(data, expectedResponse);
			});
			assert.equal(requests.length, indexOfLastInitRequest(2));
			requests[indexOfLastInitRequest(1)].respond(200,
				{ "Content-Type": "application/json" },
				'{ "install": { "total": 5, "unique": 2 }, "open": { "total": 4, "unique": 3 }, "buy": { "total": 7, "unique": 3 } }');
		});
	});

	describe('redeem', function() {
		it('should make two requests and return error if present', function(done) {
			var assert = testUtils.plan(numberOfAsserts(2), done);
			branchInit(assert);
			branch.redeem(5, "rubies", function(err, data) {
				assert.deepEqual(data, null);
			});
			assert.equal(requests.length, indexOfLastInitRequest(2));
			requests[indexOfLastInitRequest(1)].respond(200);
		});
	});

	describe('getCode', function() {
		it('should make two requests and return object literal with code', function(done) {
			var assert = testUtils.plan(numberOfAsserts(2), done);
			branchInit(assert);
			var codeRequested = {
				"amount":10,
				"bucket":"party",
				"calculation_type":1,
				"location":2
			};
			var expectedResponse = { "referral_code": "1234567" };
			branch.getCode(codeRequested, function(err, data) {
				assert.deepEqual(data, expectedResponse);
			});
			assert.equal(requests.length, indexOfLastInitRequest(2));
			requests[indexOfLastInitRequest(1)].respond(200,
				{ "Content-Type": "application/json" },
				JSON.stringify(expectedResponse));
		});
	});

	describe('validateCode', function() {
		it('should make two requests and return object literal with code', function(done) {
			var assert = testUtils.plan(numberOfAsserts(2), done);
			branchInit(assert);
			var code = "1234567";
			branch.validateCode(code, function(err, data) {
				assert.deepEqual(data, null);
			});
			assert.equal(requests.length, indexOfLastInitRequest(2));
			requests[indexOfLastInitRequest(1)].respond(200);
		});
	});

	describe('applyCode', function() {
		it('should make two requests and return object literal with code', function(done) {
			var assert = testUtils.plan(numberOfAsserts(2), done);
			branchInit(assert);
			var code = "1234567";
			branch.applyCode(code, function(err, data) {
				assert.deepEqual(data, null);
			});
			assert.equal(requests.length, indexOfLastInitRequest(2));
			requests[indexOfLastInitRequest(1)].respond(200);
		});
	});

	describe('creditHistory', function() {
		it('should make two requests and return error if present', function(done) {
			var assert = testUtils.plan(numberOfAsserts(2), done);
			branchInit(assert);
			var expectedResponse = [{
				"transaction": {
					"date": "2014-10-14T01:54:40.425Z",
					"id": "50388077461373184",
					"bucket": "default",
					"type": 0,
					"amount": 5
				},
				"referrer": "12345678",
				"referree": null
				},
				{
				"transaction": {
					"date": "2014-10-14T01:55:09.474Z",
					"id": "50388199301710081",
					"bucket": "default",
					"type": 2,
					"amount": -3
				},
				"referrer": null,
				"referree": "12345678"
			}];
			branch.creditHistory(function(err, data) {
				assert.deepEqual(data, expectedResponse);
			});
			assert.equal(requests.length, indexOfLastInitRequest(2));
			requests[indexOfLastInitRequest(1)].respond(200,
				{ "Content-Type": "application/json" },
				JSON.stringify(expectedResponse));
		});
	});

	describe('credits', function() {
		it('should make three requests and return credits', function(done) {
			var assert = testUtils.plan(numberOfAsserts(2), done);
			var expectedResponse = { "default":"0" };
			branchInit(assert);
			branch.credits(function(err, data) {
				assert.deepEqual(data, expectedResponse);
			});
			assert.equal(requests.length, indexOfLastInitRequest(2));
			requests[indexOfLastInitRequest(1)].respond(200,
				{ "Content-Type": "application/json" },
				'{ "default":"0" }');
		});
	});
});
