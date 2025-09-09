import { useState, useEffect } from 'react';
import { createWalletClient, custom, parseAbi, formatEther } from 'viem';
import { liskSepolia } from 'viem/chains';
import client from './Client';

// Contract configuration
const CONTRACT_ADDRESS = '0x389c7aF690CaD99f2FB604B2fe4c5b4bff9EFF2e'; 
const CONTRACT_ABI = parseAbi([
  'event TaskCompleted(uint256 id)',
  'event TaskCreated(uint256 id, string description)',
  'event TaskUpdated(uint256 id, string description)',
  'function completeTask(uint256 id) external',
  'function createTask(string memory description) external',
  'function getTask(uint256 id) external view returns ((uint256 id, string description, bool completed))',
  'function updateTask(uint256 id, string memory description) external'
]);

interface Task {
  id: bigint;
  description: string;
  completed: boolean;
}

interface Event {
  type: 'TaskCreated' | 'TaskUpdated' | 'TaskCompleted';
  id: bigint;
  description?: string;
  blockNumber: bigint;
  transactionHash: string;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ethereum?: any;
  }
}

export default function TodoDApp() {
  const [account, setAccount] = useState<string>('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [editingTask, setEditingTask] = useState<{ id: bigint; description: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [walletClient, setWalletClient] = useState<ReturnType<typeof createWalletClient> | null>(null);
  const [balance, setBalance] = useState<string>('0');

  // Initialize clients
  useEffect(() => {
    // Check if wallet is already connected
    const checkConnection = async () => {
      try {
        const ethereum = window.ethereum;
        if (ethereum) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const provider = ethereum.providers?.find((p: any) => p.isMetaMask) || ethereum;
          const accounts = await provider.request({ method: 'eth_accounts' });
          if (accounts.length > 0) {
            const walletClient = createWalletClient({
              chain: liskSepolia,
              transport: custom(provider)
            });
            setWalletClient(walletClient);
            setAccount(accounts[0]);
          }
        }
      } catch (error) {
        // Silently handle connection check errors
        console.log('Wallet connection check failed:', error);
      }
    };
    
    checkConnection();
  }, []);

  // Connect wallet
  const connectWallet = async () => {
    try {
      // Check for ethereum provider with better detection
      const ethereum = window.ethereum;
      if (!ethereum) {
        setError('Please install MetaMask or another Web3 wallet');
        return;
      }

      // Clear any previous errors
      setError('');

      // If multiple wallets are detected, prefer MetaMask
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider = ethereum.providers?.find((p: any) => p.isMetaMask) || ethereum;

      const accounts = await provider.request({
        method: 'eth_requestAccounts',
      });

      if (accounts.length > 0) {
        const walletClient = createWalletClient({
          chain: liskSepolia,
          transport: custom(provider)
        });

        setWalletClient(walletClient);
        setAccount(accounts[0]);

        // Switch to Lisk Sepolia network
        try {
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x106a' }], // 4202 in hex
          });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (switchError: any) {
          if (switchError.code === 4902) {
            await provider.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: '0x106a',
                chainName: 'Lisk Sepolia Testnet',
                nativeCurrency: {
                  name: 'Sepolia Ether',
                  symbol: 'ETH',
                  decimals: 18,
                },
                rpcUrls: ['https://rpc.sepolia-api.lisk.com'],
                blockExplorerUrls: ['https://sepolia-blockscout.lisk.com/'],
              }],
            });
          }
        }
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setError(`Failed to connect wallet: ${err.message}`);
    }
  };

  // Get balance
  useEffect(() => {
    if (account) {
      const getBalance = async () => {
        try {
          const balance = await client.getBalance({ address: account as `0x${string}` });
          setBalance(formatEther(balance));
        } catch (err) {
          console.error('Failed to get balance:', err);
        }
      };
      getBalance();
    }
  }, [account]);

  // Load tasks and events
  useEffect(() => {
    if (account) {
      loadTasksAndEvents();
    }
  }, [account]);

  const loadTasksAndEvents = async () => {
    try {
      setLoading(true);
      
      // Load events to get task IDs
      const logs = await client.getLogs({
        address: CONTRACT_ADDRESS,
        events: [
          {
            type: 'event',
            name: 'TaskCreated',
            inputs: [
              { name: 'id', type: 'uint256', indexed: false },
              { name: 'description', type: 'string', indexed: false }
            ]
          },
          {
            type: 'event',
            name: 'TaskUpdated',
            inputs: [
              { name: 'id', type: 'uint256', indexed: false },
              { name: 'description', type: 'string', indexed: false }
            ]
          },
          {
            type: 'event',
            name: 'TaskCompleted',
            inputs: [
              { name: 'id', type: 'uint256', indexed: false }
            ]
          }
        ],
        fromBlock: 'earliest',
        toBlock: 'latest'
      });

      // Process events
      const processedEvents: Event[] = logs.map(log => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: log.eventName as any,
        id: log.args.id as bigint,
        // description: log.args.description as string,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash
      }));

      setEvents(processedEvents.sort((a, b) => Number(b.blockNumber - a.blockNumber)));

      // Get unique task IDs from TaskCreated events
      const taskIds = new Set<bigint>();
      logs.forEach(log => {
        if (log.eventName === 'TaskCreated') {
          taskIds.add(log.args.id as bigint);
        }
      });

      // Fetch current state of each task
      const taskPromises = Array.from(taskIds).map(async (id) => {
        try {
          const task = await client.readContract({
            address: CONTRACT_ADDRESS,
            abi: CONTRACT_ABI,
            functionName: 'getTask',
            args: [id]
          });
          return task as Task;
        } catch {
          return null;
        }
      });

      const taskResults = await Promise.all(taskPromises);
      const validTasks = taskResults.filter(task => task !== null) as Task[];
      setTasks(validTasks.sort((a, b) => Number(a.id - b.id)));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setError(`Failed to load tasks: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Create new task
  const createTask = async () => {
    if (!newTaskDescription.trim() || !walletClient) return;

    try {
      setLoading(true);
      setError('');

      const { request } = await client.simulateContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'createTask',
        args: [newTaskDescription.trim()],
        account: account as `0x${string}`
      });

      const hash = await walletClient.writeContract(request);
      
      await client.waitForTransactionReceipt({ hash });
      
      setNewTaskDescription('');
      await loadTasksAndEvents();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setError(`Failed to create task: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Update task
  const updateTask = async () => {
    if (!editingTask || !editingTask.description.trim() || !walletClient) return;

    try {
      setLoading(true);
      setError('');

      const { request } = await client.simulateContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'updateTask',
        args: [editingTask.id, editingTask.description.trim()],
        account: account as `0x${string}`
      });

      const hash = await walletClient.writeContract(request);
      
      await client.waitForTransactionReceipt({ hash });
      
      setEditingTask(null);
      await loadTasksAndEvents();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setError(`Failed to update task: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Complete task
  const completeTask = async (id: bigint) => {
    if (!walletClient) return;

    try {
      setLoading(true);
      setError('');

      const { request } = await client.simulateContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'completeTask',
        args: [id],
        account: account as `0x${string}`
      });

      const hash = await walletClient.writeContract(request);
      
      await client.waitForTransactionReceipt({ hash });
      
      await loadTasksAndEvents();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setError(`Failed to complete task: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const formatAddress = (address: string) => 
    `${address.slice(0, 6)}...${address.slice(-4)}`;

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'TaskCreated': return <span className="w-4 h-4 text-green-500 font-bold">+</span>;
      case 'TaskUpdated': return <span className="w-4 h-4 text-blue-500 font-bold">✎</span>;
      case 'TaskCompleted': return <span className="w-4 h-4 text-purple-500 font-bold">✓</span>;
      default: return null;
    }
  };

  return (
    <div className="min-h-screen w-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-white mb-4">
            Todo DApp
          </h1>
          <p className="text-xl text-purple-200">
            Decentralized Task Management on Lisk Sepolia
          </p>
        </div>

        {/* Wallet Connection */}
        {!account ? (
          <div className="max-w-md mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
            <div className="text-center">
              <div className="w-16 h-16 text-purple-400 mx-auto mb-4 flex items-center justify-center bg-purple-500/20 rounded-full">
                <span className="text-2xl">💼</span>
              </div>
              <h2 className="text-2xl font-semibold text-white mb-4">Connect Wallet</h2>
              <p className="text-purple-200 mb-6">
                Connect your wallet to start managing tasks on the blockchain
              </p>
              <button
                onClick={connectWallet}
                className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white py-3 rounded-lg font-semibold hover:from-purple-700 hover:to-blue-700 transition-all duration-200"
              >
                Connect MetaMask
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Account Info */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-purple-200">Connected Account</p>
                  <p className="text-white font-mono text-lg">{formatAddress(account)}</p>
                </div>
                <div className="text-right">
                  <p className="text-purple-200">ETH Balance</p>
                  <p className="text-white font-semibold text-lg">{parseFloat(balance).toFixed(4)}</p>
                </div>
              </div>
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-red-500/20 backdrop-blur-lg rounded-xl p-4 border border-red-500/30">
                <div className="flex items-center space-x-2">
                  <span className="w-5 h-5 text-red-400">⚠️</span>
                  <p className="text-red-200">{error}</p>
                </div>
              </div>
            )}

            <div className="grid lg:grid-cols-2 gap-8">
              {/* Task Management */}
              <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
                <h2 className="text-2xl font-semibold text-white mb-6">Tasks</h2>
                
                {/* Create Task */}
                <div className="mb-6">
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      placeholder="Enter task description..."
                      value={newTaskDescription}
                      onChange={(e) => setNewTaskDescription(e.target.value)}
                      className="flex-1 bg-white/20 backdrop-blur border border-white/30 rounded-lg px-4 py-2 text-white placeholder-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      onKeyPress={(e) => e.key === 'Enter' && createTask()}
                    />
                    <button
                      onClick={createTask}
                      disabled={loading || !newTaskDescription.trim()}
                      className="bg-gradient-to-r from-green-600 to-emerald-600 text-white px-6 py-2 rounded-lg font-semibold hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      <span className="text-lg">+</span>
                    </button>
                  </div>
                </div>

                {/* Task List */}
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {loading && tasks.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="animate-spin w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                      <p className="text-purple-200">Loading tasks...</p>
                    </div>
                  ) : tasks.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-purple-200">No tasks yet. Create your first task!</p>
                    </div>
                  ) : (
                    tasks.map((task) => (
                      <div key={task.id.toString()} className="bg-white/10 rounded-lg p-4 border border-white/20">
                        {editingTask?.id === task.id ? (
                          <div className="flex space-x-2">
                            <input
                              type="text"
                              value={editingTask.description}
                              onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value })}
                              className="flex-1 bg-white/20 backdrop-blur border border-white/30 rounded px-3 py-1 text-white"
                              onKeyPress={(e) => e.key === 'Enter' && updateTask()}
                            />
                            <button
                              onClick={updateTask}
                              disabled={loading}
                              className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                              <span>✓</span>
                            </button>
                            <button
                              onClick={() => setEditingTask(null)}
                              className="bg-gray-600 text-white px-3 py-1 rounded hover:bg-gray-700"
                            >
                              <span>✕</span>
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <span className="text-purple-300 font-mono text-sm">#{task.id.toString()}</span>
                              <span className={`${task.completed ? 'line-through text-gray-400' : 'text-white'}`}>
                                {task.description}
                              </span>
                              {task.completed && <span className="text-green-500">✓</span>}
                            </div>
                            <div className="flex space-x-2">
                              {!task.completed && (
                                <>
                                  <button
                                    onClick={() => setEditingTask({ id: task.id, description: task.description })}
                                    className="text-blue-400 hover:text-blue-300 px-2 py-1"
                                  >
                                    <span>✎</span>
                                  </button>
                                  <button
                                    onClick={() => completeTask(task.id)}
                                    disabled={loading}
                                    className="text-green-400 hover:text-green-300 disabled:opacity-50 px-2 py-1"
                                  >
                                    <span>✓</span>
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Events */}
              <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
                <h2 className="text-2xl font-semibold text-white mb-6">Recent Events</h2>
                
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {events.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-purple-200">No events yet</p>
                    </div>
                  ) : (
                    events.slice(0, 20).map((event, index) => (
                      <div key={`${event.transactionHash}-${index}`} className="bg-white/10 rounded-lg p-4 border border-white/20">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            {getEventIcon(event.type)}
                            <div>
                              <p className="text-white font-medium">{event.type}</p>
                              <p className="text-purple-200 text-sm">Task #{event.id.toString()}</p>
                              {event.description && (
                                <p className="text-purple-300 text-sm truncate max-w-xs">{event.description}</p>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-purple-200 text-sm">Block {event.blockNumber.toString()}</p>
                            <a
                              href={`https://sepolia-blockscout.lisk.com/tx/${event.transactionHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-purple-400 hover:text-purple-300 text-sm flex items-center space-x-1"
                            >
                              <span>View</span>
                              <span className="text-xs">🔗</span>
                            </a>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Contract Info */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
              <h3 className="text-lg font-semibold text-white mb-4">Contract Information</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-purple-200">Network</p>
                  <p className="text-white font-mono">Lisk Sepolia Testnet</p>
                </div>
                <div>
                  <p className="text-purple-200">Contract Address</p>
                  <div className="flex items-center space-x-2">
                    <p className="text-white font-mono text-sm">{formatAddress(CONTRACT_ADDRESS)}</p>
                    <a
                      href={`https://sepolia-blockscout.lisk.com/address/${CONTRACT_ADDRESS}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-purple-400 hover:text-purple-300"
                    >
                      <span className="text-sm">🔗</span>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}