function _isStandAlone() {
    return process.env.standalone == 'true';
}

function _isVerbose(level = 0){
    var verboseLevel = process.env.pocketVerbose != undefined ? process.env.pocketVerbose : -1;
    
    return (_isStandAlone() && (level <= verboseLevel));
}

module.exports._isStandAlone = _isStandAlone;
module.exports._isVerbose = _isVerbose;