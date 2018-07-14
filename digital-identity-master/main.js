var web3Utility = require('./js/utility/web3.js');
var config = require('./js/config.js');
var Buffer = web3Utility.Buffer;
var async = require('async');
var cookieUtility = require("./js/utility/cookie.js");
var crypto = require("./js/crypto.js");
var networkUtility = require("./js/utility/network.js");
var ipfsHelper = require("./js/utility/ipfs.js");

//** Globals ** //

var web3 = web3Utility.initWeb3(new Web3(), config.ethProvider, {"network": "kovan", "etherscanApiKey": config.etherscanApiKey});
var ipfs = ipfsHelper.initIpfs(config.ipfsProtocol + "://" + config.ipfsIpAddress, config.ipfsPort);
var registryContract;
var userAccount;
var scanner;
var ownIpfsHash;

//**  ** //

main();

function main() {
    initUi();

    initClickListeners();

    loadData();
}

function initUi() {
    initScanner();
    initProfile();
}

function initProfile() {
    loadTemplate(config.baseUrl + '/html/' + 'profile.ejs', 'profileContainer', {});
    initUserInfo();
}

function initScanner() {
    loadTemplate(config.baseUrl + '/html/' + 'scanner.ejs', 'scannerContainer', {});
}

function initUserInfo() {
    if (userExists()) {
        userAccount = initUserAccount();
        console.log(userAccount.publicKey);
    } else {
        initNewAccount();
    }
    showUserAccountInfo(userAccount);
}

function loadData() {
    async.waterfall([
        loadContract,
        fetchPersona,
        fetchIpfsFile
    ], function (error, result) {
        if (error) {
            showErrorState(error);
        } else {
            populateFormWithPersonaData(result);
        }
    });
}

function beginScanner() {
    scanner = new Instascan.Scanner({ video: document.getElementById('preview'), facingMode: 'environment' });
    scanner.addListener('scan', function (content) {
        console.log(content);
        parseScannedContent(content, function(error, result) {
            if (error) {
                showErrorMessage(error)
            } else {
                var txHash = result.hash;
                showSuccessMessage("Shared data successfully: \n <a target='_blank' href='https://kovan.etherscan.io/tx/" + txHash + "'>View transaction</a>" )
            }
        });
    });

    Instascan.Camera.getCameras().then(function (cameras) {
        if (cameras.length > 0) {
            // todo fix rear camera issue
            var index = (cameras.length > 1 && cameras[1]) ? 1 : 0;
            console.log(index);

            if (scanner) {
                try {
                    scanner.start(cameras[0]);
                } catch(e) {
                    console.log(e);
                    console.log(e.message);
                }
            }
        } else {
            console.error('No cameras found.');
        }
    }).catch(function (e) {
        console.error(e.message);
    });
}

function parseScannedContent(content, callback) {
    var data = JSON.parse(content);
    if (data.publicKey && data.hash && data.permissions) {
        showAuthorizationDialog(data, function(data) {

            var fileContents = buildFileContents(data.permissions);
            var encryptedData = crypto.encrypt(data.publicKey, userAccount.privateKey, fileContents);

            networkUtility.post(config.identityRouterUrl + "/" + data.hash, {}, {"data": encryptedData}, function (error, response) {
                if (error) {
                    console.error(error);
                    callback(error, undefined);
                } else {
                    console.log(response);
                    callback(undefined, response);
                }
            });
        });
    } else {
        console.log("invalid format");
    }
}

function createRecordInSmartContract(address, ipfsPointer, callback) {
    var key = web3.fromAscii("identity_profile");
    web3Utility.send(web3, registryContract, config.personaRegistryAddress, 'setClaim', [address, key, ipfsPointer, {
        gas: 250000,
        price: config.defaultGasPrice,
        value: 0
    }], userAccount.address, userAccount.privateKey, undefined, function (functionError, result) {
        if (functionError) {
            console.log(functionError);
            callback(functionError, undefined);
        } else {
            console.log(result);
            callback(undefined, result);
        }
    });
}

function stopScanner() {
    if (scanner) {
      scanner.stop();
    }
}

function showAuthorizationDialog(data, callback) {
    var permissionsTableHtml = "<table class='permissions'>"
    for (var i = 0; i < data.permissions.length; i++) {
        permissionsTableHtml += "<tr><td>"
        if (data.permissions[i] === "name") {
            permissionsTableHtml += '<i class="fa fa-user fa-2x"></i>'
        } else if (data.permissions[i] === "email") {
            permissionsTableHtml += '<i class="fa fa-envelope fa-2x"></i>'
        } else if (data.permissions[i] === "city") {
            permissionsTableHtml += '<i class="fa fa-building fa-2x"></i>'
        } else if (data.permissions[i] === "country") {
            permissionsTableHtml += '<i class="fa fa-flag fa-2x"></i>'
        }
        permissionsTableHtml += "</td><td>&nbsp;</td><td>" + data.permissions[i] + "</td>";
        permissionsTableHtml += "</tr>"
    }
    permissionsTableHtml += "</table>";

    alertify.confirm("Confirm Transaction",
        "<div id='alert-icon'></div><h2><b>" + data.name + "</b></h2> " +
        "<h4>is requesting access to the following data: </h4>" +
        "</br>" +
        "</br>" +
        permissionsTableHtml +
        "</br>" +
        "</br>", function (closeEvent) {
            callback(data);
    }, function() {
        showErrorMessage("App not authorized");
    }).set('labels', {ok:'Approve', cancel:'Reject'});

    document.getElementById('alert-icon').style.backgroundImage = 'url(' + blockies.create({
        seed: account.address, size: 8, scale: 16
    }).toDataURL()+')'
}

function showErrorState(error) {

}

function loadTemplate(url, element, data) {
    if ($('#' + element).length) {
        new EJS({url: url}).update(element, data);
    } else {
        console.log(element + ' template found')
    }
}

function showScannerTab() {
    beginScanner();
    $('#scannerContainer').show();
    $('#profileContainer').hide();
}

function showProfileTab() {
    stopScanner();

    $('#scannerContainer').hide();
    $('#profileContainer').show();
}

function userExists() {
    return cookieUtility.readCookie("account");
}

function initUserAccount() {
    return JSON.parse(cookieUtility.readCookie("account"));
}

function initNewAccount() {
    userAccount = web3Utility.createAccount();
    cookieUtility.saveCookie("account", JSON.stringify(userAccount));
}

function showUserAccountInfo(account) {
    $('#user-address').text(account.address);
    $('#user-public-key').text(crypto.createPublicKey(userAccount.privateKey).toString());
    $('#user-private-key').text(account.privateKey);

    document.getElementById('icon').style.backgroundImage = 'url(' + blockies.create({
        seed: account.address, size: 8, scale: 16
    }).toDataURL()+')'
}

function loadContract(callback) {
    web3Utility.loadContract(web3, config.baseUrl, config.personaRegistryContract + ".json", config.personaRegistryAddress,
        function(error, contract) {
        if (error) {
            console.log(error);
            callback(error, undefined);
        } else {
            registryContract = contract;
            callback(null, contract);
        }
    });
}

function fetchPersona(contract, callback) {
    var key = web3.fromAscii("identity_profile");
    web3Utility.callContractFunction(web3, contract, config.personaRegistryAddress, 'getClaim',
        [userAccount.address, userAccount.address, key], function(error, result) {
        if (error) {
            console.log(error);
            callback(error, undefined);
        } else {
            if (result === "0x0000000000000000000000000000000000000000000000000000000000000000") {
                callback(undefined, "");
            } else {
                ownIpfsHash = web3.toAscii(result);
                console.log(ownIpfsHash);
                callback(undefined, ownIpfsHash);
            }
        }
    });
}

function populateFormWithPersonaData(fileContents) {
    console.log(fileContents);
    try {
        var decrypted = JSON.parse(crypto.decrypt(userAccount.privateKey, fileContents));
        for (var field in decrypted) {
            if (decrypted.hasOwnProperty(field)) {
                $('input[name="' + field + '"]').val(decrypted[field]);
            }
        }
    } catch(error) {
        console.log(error);
    }
}

function showNewAccountPrompt(account) {
    var message = "Here is your new Ethereum account: " + account.address +
        "<br /><br />Please BACKUP the private key for this account: " + account.privateKey +
        "<br /><br />and DO NOT share it with anybody. ";

    alertify.alert("New Keys Created", message);
}

function initClickListeners() {
    $('#create-button').click(function() {
        createPersona();
    });

    $('#public-key-toggle').click(function() {
        $('#user-public-key').show();
    });

    $('#private-key-toggle').click(function() {
        $('#user-private-key').show();
    });

    $('#tab-scanner').click(function() {
        showScannerTab();
    });

    $('#tab-profile').click(function() {
        showProfileTab();
    });
}

function createPersona() {
    savePersonaForSelf(function(error, result) {
        if (error) {
            showErrorMessage(error);
        } else {
            var txHash = result.txHash;
            showSuccessMessage("Information updated successfully: \n <a target='_blank' href='https://kovan.etherscan.io/tx/" + txHash + "'>View transaction</a>" )
        }
    });
}

function showErrorMessage(message) {
    alertify.error(message);
}

function showSuccessMessage(message) {
    alertify.success(message);
}

function savePersonaForSelf(callback) {
    var publicKey = crypto.createPublicKey(userAccount.privateKey).toString();
    console.log(publicKey);

    var fileContents = buildFileContents(["name", "email", "city", "country"]);
    var encryptedData = crypto.encrypt(publicKey, userAccount.privateKey, fileContents);

    saveIpfsFile(publicKey + "-" + publicKey, encryptedData, function(error, response) {
        if (error) {
            console.log(error);
            callback(error, undefined);
        } else {
            var ipfsPointer = response[0].hash;

            if (ownIpfsHash !== ipfsPointer) {
                alertify.confirm("Confirm Transaction", "<h2>Save record in smart contract.</h2>" +
                    "</br>" +
                    "<table>" +
                    "<tr><td><b>From:</b></td><td>&nbsp;</td><td>" + userAccount.address + "</td></tr>" +
                    "<tr><td><b>To:</b></td><td>&nbsp;</td><td>" + config.personaRegistryAddress + "</td></tr>" +
                    "<tr><td><b>Gas Cost:</b></td><td>&nbsp;</td><td>(Estimated) 0.00052 - 0.00172 ETH</td></tr>" +
                    "</table>" +
                    "</br>", function (closeEvent) {
                        createRecordInSmartContract(userAccount.address, ipfsPointer, function (functionError, result) {
                            if (functionError) {
                                console.log(functionError);
                                callback(functionError, undefined);
                            } else {
                                console.log(result);
                                callback(undefined, result);
                            }
                        });
                }, function() {
                    showErrorMessage("Record not created");
                }).set('labels', {ok:'Approve', cancel:'Reject'})
            } else {
                callback(undefined, response);
            }
        }
    });
}

function buildFileContents(fields) {
    var data = {};
    for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        data[field] = $('input[name="' + field + '"]').val();
    }

    return JSON.stringify(data);
}

function fetchIpfsFile(ipfsPointer, callback) {
    if (!ipfsPointer) {
        callback("No pointer found", undefined);
    } else {
        networkUtility.get(config.ipfsFetchUrl + "/" +  ipfsPointer, {}, function (error, response) {
            if (error) {
                callback(error.message, undefined);
            } else if (response.error) {
                callback(response.error, undefined);
            } else {
                callback(undefined, response);
            }
        })
    }
}

function saveIpfsFile(name, data, callback) {
    ipfsHelper.saveIpfsFile(ipfs, name, data, function(error, response) {
        if (error) {
            callback(error.message, undefined);
        } else {
            callback(undefined, response);
        }
    });
}
