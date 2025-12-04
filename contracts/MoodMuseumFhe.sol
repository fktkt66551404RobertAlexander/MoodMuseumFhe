// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MoodMuseumFhe is SepoliaConfig {
    struct EncryptedMood {
        uint256 id;
        euint32 encryptedMoodValue;   // Encrypted mood value
        uint256 timestamp;
        address user;
    }
    
    struct Recommendation {
        uint256 moodId;
        euint32 encryptedExhibitId;   // Encrypted recommended exhibit
        euint32 encryptedRouteId;      // Encrypted recommended route
        bool isRevealed;
    }
    
    // Contract state
    uint256 public moodCount;
    mapping(uint256 => EncryptedMood) public encryptedMoods;
    mapping(uint256 => Recommendation) public recommendations;
    
    // Mood-exhibit mapping (encrypted)
    mapping(uint32 => euint32) private encryptedExhibitMapping;
    
    // Request tracking
    mapping(uint256 => uint256) private requestToMoodId;
    
    // Events
    event MoodSubmitted(uint256 indexed id, address indexed user, uint256 timestamp);
    event RecommendationGenerated(uint256 indexed moodId);
    event RecommendationDecrypted(uint256 indexed moodId);
    
    modifier onlyUser(uint256 moodId) {
        require(msg.sender == encryptedMoods[moodId].user, "Not authorized");
        _;
    }
    
    /// @notice Submit encrypted mood value
    function submitEncryptedMood(euint32 encryptedMoodValue) public {
        moodCount += 1;
        uint256 newId = moodCount;
        
        encryptedMoods[newId] = EncryptedMood({
            id: newId,
            encryptedMoodValue: encryptedMoodValue,
            timestamp: block.timestamp,
            user: msg.sender
        });
        
        // Initialize recommendation state
        recommendations[newId] = Recommendation({
            moodId: newId,
            encryptedExhibitId: FHE.asEuint32(0),
            encryptedRouteId: FHE.asEuint32(0),
            isRevealed: false
        });
        
        emit MoodSubmitted(newId, msg.sender, block.timestamp);
    }
    
    /// @notice Generate personalized recommendation
    function generateRecommendation(uint256 moodId) public {
        EncryptedMood storage mood = encryptedMoods[moodId];
        require(recommendations[moodId].encryptedExhibitId.isInitialized() == false, "Already generated");
        
        // Mood-based exhibit selection (FHE operations)
        euint32 exhibitId = FHE.rem(mood.encryptedMoodValue, FHE.asEuint32(10));
        euint32 routeId = FHE.add(exhibitId, FHE.asEuint32(100));
        
        recommendations[moodId].encryptedExhibitId = exhibitId;
        recommendations[moodId].encryptedRouteId = routeId;
        
        emit RecommendationGenerated(moodId);
    }
    
    /// @notice Request recommendation decryption
    function requestRecommendationDecryption(uint256 moodId) public onlyUser(moodId) {
        Recommendation storage rec = recommendations[moodId];
        require(!rec.isRevealed, "Already revealed");
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(rec.encryptedExhibitId);
        ciphertexts[1] = FHE.toBytes32(rec.encryptedRouteId);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptRecommendation.selector);
        requestToMoodId[reqId] = moodId;
    }
    
    /// @notice Callback for decrypted recommendation
    function decryptRecommendation(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 moodId = requestToMoodId[requestId];
        require(moodId != 0, "Invalid request");
        
        Recommendation storage rec = recommendations[moodId];
        require(!rec.isRevealed, "Already revealed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        
        // Store decrypted values (in real app, would be returned to user)
        // exhibitId = results[0]
        // routeId = results[1]
        
        rec.isRevealed = true;
        emit RecommendationDecrypted(moodId);
    }
    
    /// @notice Set mood-exhibit mapping
    function setMoodExhibitMapping(uint32 moodValue, euint32 exhibitId) public {
        encryptedExhibitMapping[moodValue] = exhibitId;
    }
    
    /// @notice Get recommendation status
    function getRecommendationStatus(uint256 moodId) public view returns (bool isRevealed) {
        return recommendations[moodId].isRevealed;
    }
}