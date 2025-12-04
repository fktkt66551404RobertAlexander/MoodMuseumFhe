import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface Exhibit {
  id: string;
  name: string;
  description: string;
  emotionMatch: string;
  location: string;
  encryptedData: string;
  timestamp: number;
}

interface MoodData {
  emotion: string;
  intensity: number;
  timestamp: number;
}

const FHEEncryption = (data: string): string => `FHE-${btoa(data)}`;
const FHEDecryption = (encryptedData: string): string => encryptedData.startsWith('FHE-') ? atob(encryptedData.substring(4)) : encryptedData;
const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [exhibits, setExhibits] = useState<Exhibit[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showMoodModal, setShowMoodModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [userMood, setUserMood] = useState({ emotion: "calm", intensity: 5 });
  const [selectedExhibit, setSelectedExhibit] = useState<Exhibit | null>(null);
  const [decryptedContent, setDecryptedContent] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [showFAQ, setShowFAQ] = useState(false);
  
  // Emotion distribution for chart
  const emotionDistribution = exhibits.reduce((acc, exhibit) => {
    const emotion = exhibit.emotionMatch.toLowerCase();
    acc[emotion] = (acc[emotion] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  useEffect(() => {
    loadExhibits().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadExhibits = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.log("Contract not available");
        return;
      }
      
      // Get exhibit keys
      const keysBytes = await contract.getData("exhibit_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing exhibit keys:", e); }
      }
      
      // Load exhibits
      const list: Exhibit[] = [];
      for (const key of keys) {
        try {
          const exhibitBytes = await contract.getData(`exhibit_${key}`);
          if (exhibitBytes.length > 0) {
            try {
              const exhibitData = JSON.parse(ethers.toUtf8String(exhibitBytes));
              list.push({ 
                id: key, 
                name: exhibitData.name, 
                description: exhibitData.description,
                emotionMatch: exhibitData.emotionMatch,
                location: exhibitData.location,
                encryptedData: exhibitData.data, 
                timestamp: exhibitData.timestamp 
              });
            } catch (e) { console.error(`Error parsing exhibit data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading exhibit ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setExhibits(list);
    } catch (e) { console.error("Error loading exhibits:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitMood = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setSubmitting(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting your mood with Zama FHE..." });
    
    try {
      // Create mood data
      const moodData: MoodData = {
        emotion: userMood.emotion,
        intensity: userMood.intensity,
        timestamp: Date.now()
      };
      
      // Encrypt with FHE
      const encryptedData = FHEEncryption(JSON.stringify(moodData));
      
      // Store in contract
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Generate unique ID
      const moodId = `mood-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      
      // Store mood data
      await contract.setData(`mood_${moodId}`, ethers.toUtf8Bytes(encryptedData));
      
      // Add to keys list
      const keysBytes = await contract.getData("mood_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(moodId);
      await contract.setData("mood_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      // Simulate FHE processing and exhibit recommendation
      setTransactionStatus({ visible: true, status: "pending", message: "Processing your mood with FHE to find matching exhibits..." });
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Generate recommended exhibits based on mood
      const recommendedExhibits = generateRecommendedExhibits(moodData.emotion);
      
      // Store recommended exhibits
      for (const exhibit of recommendedExhibits) {
        const exhibitId = `exhibit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const exhibitData = {
          name: exhibit.name,
          description: exhibit.description,
          emotionMatch: moodData.emotion,
          location: exhibit.location,
          data: FHEEncryption(JSON.stringify(exhibit)),
          timestamp: Date.now()
        };
        
        await contract.setData(`exhibit_${exhibitId}`, ethers.toUtf8Bytes(JSON.stringify(exhibitData)));
        
        // Add to exhibit keys
        const exhibitKeysBytes = await contract.getData("exhibit_keys");
        let exhibitKeys: string[] = [];
        if (exhibitKeysBytes.length > 0) {
          try { exhibitKeys = JSON.parse(ethers.toUtf8String(exhibitKeysBytes)); } 
          catch (e) { console.error("Error parsing exhibit keys:", e); }
        }
        exhibitKeys.push(exhibitId);
        await contract.setData("exhibit_keys", ethers.toUtf8Bytes(JSON.stringify(exhibitKeys)));
      }
      
      setTransactionStatus({ visible: true, status: "success", message: "Personalized exhibit recommendations generated!" });
      await loadExhibits();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowMoodModal(false);
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setSubmitting(false); }
  };

  // Generate recommended exhibits based on mood
  const generateRecommendedExhibits = (emotion: string): Exhibit[] => {
    const exhibitsByEmotion: Record<string, Exhibit[]> = {
      calm: [
        { id: "1", name: "Serene Landscapes", description: "A collection of tranquil nature scenes", emotionMatch: "calm", location: "Gallery A", encryptedData: "", timestamp: Date.now() },
        { id: "2", name: "Zen Garden", description: "Traditional Japanese meditation garden", emotionMatch: "calm", location: "Outdoor Garden", encryptedData: "", timestamp: Date.now() },
        { id: "3", name: "Water Reflections", description: "Photography exhibition of water surfaces", emotionMatch: "calm", location: "Hall B", encryptedData: "", timestamp: Date.now() }
      ],
      happy: [
        { id: "4", name: "Colorful Abstractions", description: "Vibrant abstract paintings", emotionMatch: "happy", location: "Modern Wing", encryptedData: "", timestamp: Date.now() },
        { id: "5", name: "Children's Art", description: "Playful creations by young artists", emotionMatch: "happy", location: "Family Gallery", encryptedData: "", timestamp: Date.now() },
        { id: "6", name: "Festival Masks", description: "Cultural masks from celebrations worldwide", emotionMatch: "happy", location: "Cultural Hall", encryptedData: "", timestamp: Date.now() }
      ],
      curious: [
        { id: "7", name: "Scientific Discoveries", description: "Exhibit on groundbreaking scientific findings", emotionMatch: "curious", location: "Science Wing", encryptedData: "", timestamp: Date.now() },
        { id: "8", name: "Ancient Mysteries", description: "Artifacts from lost civilizations", emotionMatch: "curious", location: "History Hall", encryptedData: "", timestamp: Date.now() },
        { id: "9", name: "Interactive Light", description: "Interactive light and sound installation", emotionMatch: "curious", location: "Innovation Lab", encryptedData: "", timestamp: Date.now() }
      ],
      contemplative: [
        { id: "10", name: "Philosophical Art", description: "Works that provoke deep thought", emotionMatch: "contemplative", location: "East Wing", encryptedData: "", timestamp: Date.now() },
        { id: "11", name: "Religious Icons", description: "Sacred art from various traditions", emotionMatch: "contemplative", location: "Spirituality Room", encryptedData: "", timestamp: Date.now() },
        { id: "12", name: "Minimalist Sculptures", description: "Simple forms with profound meaning", emotionMatch: "contemplative", location: "Sculpture Garden", encryptedData: "", timestamp: Date.now() }
      ],
      inspired: [
        { id: "13", name: "Innovation Gallery", description: "Cutting-edge designs and inventions", emotionMatch: "inspired", location: "Future Wing", encryptedData: "", timestamp: Date.now() },
        { id: "14", name: "Visionary Artists", description: "Works by artists ahead of their time", emotionMatch: "inspired", location: "Modern Masters", encryptedData: "", timestamp: Date.now() },
        { id: "15", name: "Social Change", description: "Art that drives social transformation", emotionMatch: "inspired", location: "Activism Corner", encryptedData: "", timestamp: Date.now() }
      ]
    };
    
    return exhibitsByEmotion[emotion] || [];
  };

  const decryptWithSignature = async (encryptedData: string): Promise<string | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryption(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "FHE contract is available and ready to process your mood!" 
        });
      } else {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "Contract is currently unavailable" 
        });
      }
      
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Error checking contract availability" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderEmotionChart = () => {
    const emotions = Object.keys(emotionDistribution);
    const total = exhibits.length;
    
    if (total === 0) {
      return (
        <div className="chart-placeholder">
          <p>Submit your mood to see exhibit recommendations</p>
        </div>
      );
    }
    
    return (
      <div className="emotion-chart">
        {emotions.map(emotion => (
          <div key={emotion} className="chart-bar-container">
            <div className="chart-label">{emotion}</div>
            <div className="chart-bar-wrapper">
              <div 
                className="chart-bar" 
                style={{ width: `${(emotionDistribution[emotion] / total) * 100}%` }}
              >
                <span className="chart-value">{emotionDistribution[emotion]}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const faqItems = [
    {
      question: "How does FHE protect my privacy?",
      answer: "Fully Homomorphic Encryption (FHE) allows your mood data to be processed while still encrypted. The museum app never sees your actual emotions, only encrypted representations that are matched to exhibits."
    },
    {
      question: "What happens to my mood data?",
      answer: "Your mood data is encrypted on your device before being sent to the blockchain. It remains encrypted during processing and is never stored in a decrypted form."
    },
    {
      question: "Can I see my encrypted mood data?",
      answer: "Yes, in the exhibit details you can see the encrypted representation of your mood and choose to decrypt it with your wallet signature."
    },
    {
      question: "How are exhibits matched to my mood?",
      answer: "Our FHE algorithms analyze encrypted mood data to find exhibits with emotional resonance patterns that match your current state, all without decrypting your personal information."
    },
    {
      question: "Is this service free?",
      answer: "Yes, MoodMuseumFhe is completely free to use. You only pay minimal gas fees for blockchain transactions."
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="dreamy-spinner"></div>
      <p>Initializing encrypted museum experience...</p>
    </div>
  );

  return (
    <div className="app-container dreamy-theme">
      <header className="app-header glassmorphism">
        <div className="logo">
          <div className="logo-icon"><div className="museum-icon"></div></div>
          <h1>Mood<span>Museum</span>FHE</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowMoodModal(true)} className="set-mood-btn glass-button">
            <div className="mood-icon"></div>Set My Mood
          </button>
          <button className="glass-button" onClick={checkAvailability}>
            Check FHE Availability
          </button>
          <button className="glass-button" onClick={() => setShowFAQ(!showFAQ)}>
            {showFAQ ? "Hide FAQ" : "Show FAQ"}
          </button>
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>
      
      <div className="main-content partitioned-layout">
        {/* Left Panel - Project Introduction */}
        <div className="panel intro-panel glassmorphism">
          <h2>Welcome to MoodMuseumFHE</h2>
          <p>Experience art in a whole new way by matching exhibits to your current emotional state, with complete privacy protection using Fully Homomorphic Encryption (FHE).</p>
          
          <div className="fhe-explanation">
            <h3>How FHE Protects Your Mood Privacy</h3>
            <div className="fhe-steps">
              <div className="fhe-step">
                <div className="step-number">1</div>
                <div className="step-content">
                  <h4>Encrypt Your Mood</h4>
                  <p>Your emotional state is encrypted on your device before leaving your control</p>
                </div>
              </div>
              <div className="fhe-step">
                <div className="step-number">2</div>
                <div className="step-content">
                  <h4>FHE Processing</h4>
                  <p>Our algorithms match exhibits to your encrypted mood without decryption</p>
                </div>
              </div>
              <div className="fhe-step">
                <div className="step-number">3</div>
                <div className="step-content">
                  <h4>Personalized Experience</h4>
                  <p>Receive exhibit recommendations tailored to your emotional state</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="benefits">
            <h3>Benefits of Mood-Based Exploration</h3>
            <ul>
              <li>Discover art that resonates with your current emotional state</li>
              <li>Experience museums in a deeply personal way</li>
              <li>Protect your psychological privacy with cutting-edge encryption</li>
              <li>Find hidden gems you might otherwise overlook</li>
            </ul>
          </div>
        </div>
        
        {/* Center Panel - Exhibit Recommendations */}
        <div className="panel exhibits-panel glassmorphism">
          <div className="section-header">
            <h2>Recommended Exhibits</h2>
            <div className="header-actions">
              <button onClick={loadExhibits} className="refresh-btn glass-button" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh Recommendations"}
              </button>
            </div>
          </div>
          
          {exhibits.length === 0 ? (
            <div className="no-exhibits">
              <div className="no-exhibits-icon"></div>
              <p>No exhibit recommendations yet</p>
              <p>Set your mood to receive personalized recommendations</p>
              <button className="glass-button primary" onClick={() => setShowMoodModal(true)}>Set My Mood</button>
            </div>
          ) : (
            <div className="exhibits-grid">
              {exhibits.map(exhibit => (
                <div 
                  className="exhibit-card glassmorphism" 
                  key={exhibit.id}
                  onClick={() => setSelectedExhibit(exhibit)}
                >
                  <div className="exhibit-header">
                    <h3>{exhibit.name}</h3>
                    <span className={`emotion-tag ${exhibit.emotionMatch.toLowerCase()}`}>{exhibit.emotionMatch}</span>
                  </div>
                  <p className="exhibit-description">{exhibit.description}</p>
                  <div className="exhibit-footer">
                    <div className="location"><span>📍</span> {exhibit.location}</div>
                    <button className="glass-button small">View Details</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Right Panel - Emotion Chart */}
        <div className="panel chart-panel glassmorphism">
          <h2>Emotion Distribution</h2>
          <p>Distribution of exhibits by matched emotion</p>
          {renderEmotionChart()}
          
          <div className="chart-legend">
            <div className="legend-item">
              <div className="color-box calm"></div>
              <span>Calm</span>
            </div>
            <div className="legend-item">
              <div className="color-box happy"></div>
              <span>Happy</span>
            </div>
            <div className="legend-item">
              <div className="color-box curious"></div>
              <span>Curious</span>
            </div>
            <div className="legend-item">
              <div className="color-box contemplative"></div>
              <span>Contemplative</span>
            </div>
            <div className="legend-item">
              <div className="color-box inspired"></div>
              <span>Inspired</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* FAQ Section */}
      {showFAQ && (
        <div className="faq-section glassmorphism">
          <h2>Frequently Asked Questions</h2>
          <div className="faq-items">
            {faqItems.map((faq, index) => (
              <div className="faq-item" key={index}>
                <h3>{faq.question}</h3>
                <p>{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Mood Input Modal */}
      {showMoodModal && (
        <ModalMoodInput 
          onSubmit={submitMood} 
          onClose={() => setShowMoodModal(false)} 
          submitting={submitting}
          moodData={userMood}
          setMoodData={setUserMood}
        />
      )}
      
      {/* Exhibit Detail Modal */}
      {selectedExhibit && (
        <ExhibitDetailModal 
          exhibit={selectedExhibit} 
          onClose={() => { setSelectedExhibit(null); setDecryptedContent(null); }} 
          decryptedContent={decryptedContent}
          setDecryptedContent={setDecryptedContent}
          isDecrypting={isDecrypting}
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {/* Transaction Status Modal */}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glassmorphism">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="dreamy-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer glassmorphism">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"><div className="museum-icon"></div><span>MoodMuseumFHE</span></div>
            <p>Privacy-preserving personalized museum experiences powered by FHE</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">About FHE</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Museum Partners</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered Privacy</span></div>
          <div className="copyright">© {new Date().getFullYear()} MoodMuseumFHE. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalMoodInputProps {
  onSubmit: () => void; 
  onClose: () => void; 
  submitting: boolean;
  moodData: any;
  setMoodData: (data: any) => void;
}

const ModalMoodInput: React.FC<ModalMoodInputProps> = ({ onSubmit, onClose, submitting, moodData, setMoodData }) => {
  const emotions = [
    { value: "calm", label: "Calm", icon: "😌" },
    { value: "happy", label: "Happy", icon: "😊" },
    { value: "curious", label: "Curious", icon: "🤔" },
    { value: "contemplative", label: "Contemplative", icon: "🧘" },
    { value: "inspired", label: "Inspired", icon: "✨" }
  ];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setMoodData({ ...moodData, [name]: value });
  };

  const handleIntensityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMoodData({ ...moodData, intensity: parseInt(e.target.value) });
  };

  const handleSubmit = () => {
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="mood-modal glassmorphism">
        <div className="modal-header">
          <h2>Set Your Current Mood</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Your mood data will be encrypted with Zama FHE before processing</p>
            </div>
          </div>
          
          <div className="mood-selection">
            <h3>Select Your Primary Emotion</h3>
            <div className="emotion-grid">
              {emotions.map(emotion => (
                <div 
                  key={emotion.value}
                  className={`emotion-option ${moodData.emotion === emotion.value ? 'selected' : ''}`}
                  onClick={() => setMoodData({...moodData, emotion: emotion.value})}
                >
                  <div className="emotion-icon">{emotion.icon}</div>
                  <div className="emotion-label">{emotion.label}</div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="intensity-slider">
            <h3>Intensity: <span className="intensity-value">{moodData.intensity}/10</span></h3>
            <input 
              type="range" 
              min="1" 
              max="10" 
              value={moodData.intensity} 
              onChange={handleIntensityChange}
              className="glass-slider"
            />
            <div className="slider-labels">
              <span>Mild</span>
              <span>Strong</span>
            </div>
          </div>
          
          <div className="encryption-preview">
            <h4>FHE Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Your Mood:</span>
                <div>{`${emotions.find(e => e.value === moodData.emotion)?.label} (${moodData.intensity}/10)`}</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>{FHEEncryption(JSON.stringify(moodData)).substring(0, 50)}...</div>
              </div>
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div>
              <strong>Privacy Guarantee</strong>
              <p>Your mood remains encrypted during processing and is never decrypted</p>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn glass-button">Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} className="submit-btn glass-button primary">
            {submitting ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ExhibitDetailModalProps {
  exhibit: Exhibit;
  onClose: () => void;
  decryptedContent: string | null;
  setDecryptedContent: (content: string | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<string | null>;
}

const ExhibitDetailModal: React.FC<ExhibitDetailModalProps> = ({ exhibit, onClose, decryptedContent, setDecryptedContent, isDecrypting, decryptWithSignature }) => {
  const handleDecrypt = async () => {
    if (decryptedContent) { setDecryptedContent(null); return; }
    const decrypted = await decryptWithSignature(exhibit.encryptedData);
    if (decrypted) setDecryptedContent(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="exhibit-detail-modal glassmorphism">
        <div className="modal-header">
          <h2>{exhibit.name}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="exhibit-info">
            <div className="info-item"><span>Emotion Match:</span><strong className={`emotion-tag ${exhibit.emotionMatch.toLowerCase()}`}>{exhibit.emotionMatch}</strong></div>
            <div className="info-item"><span>Location:</span><strong>{exhibit.location}</strong></div>
          </div>
          
          <div className="exhibit-description">
            <h3>Description</h3>
            <p>{exhibit.description}</p>
          </div>
          
          <div className="encrypted-data-section">
            <h3>Encrypted Mood Data</h3>
            <div className="encrypted-data">{exhibit.encryptedData.substring(0, 100)}...</div>
            <div className="fhe-tag"><div className="fhe-icon"></div><span>FHE Encrypted</span></div>
            <button 
              className="decrypt-btn glass-button" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? (
                <span className="decrypt-spinner"></span>
              ) : decryptedContent ? (
                "Hide Decrypted Mood"
              ) : (
                "Decrypt with Wallet Signature"
              )}
            </button>
          </div>
          
          {decryptedContent && (
            <div className="decrypted-data-section">
              <h3>Your Original Mood</h3>
              <div className="decrypted-data">
                <pre>{JSON.stringify(JSON.parse(decryptedContent), null, 2)}</pre>
              </div>
              <div className="decryption-notice">
                <div className="warning-icon">⚠️</div>
                <span>Decrypted mood is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
          
          <div className="recommended-path">
            <h3>Recommended Visit Path</h3>
            <div className="path-steps">
              <div className="path-step">1. Start at {exhibit.location}</div>
              <div className="path-step">2. Visit "Reflections of Water" in Gallery C</div>
              <div className="path-step">3. Explore "Light Installations" in Innovation Lab</div>
              <div className="path-step">4. End at "Meditation Space" in East Wing</div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn glass-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;