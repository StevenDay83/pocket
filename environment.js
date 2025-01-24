function _isStandAlone() {
    return process.env.standalone == 'true';
}

function _isVerbose(level = 0){
    var verboseLevel = process.env.pocketVerbose != undefined ? process.env.pocketVerbose : -1;
    
    return (_isStandAlone() && (level <= verboseLevel));
}

function shorthandHex(hexString, first, last) {
    var shorthandHex = '';

    if (hexString && first && last){
        if (first.length <= hexString.length && last.length <= hexString){
            shorthandHex = hexString.substr(0, first) + '...' + hexString(hexString.length - last, hexString.length - 1);
        }
    }
}

module.exports._isStandAlone = _isStandAlone;
module.exports._isVerbose = _isVerbose;
module.exports.shorthandHex = shorthandHex;