import { createPublicClient, http } from "viem";
import { liskSepolia } from "viem/chains";

  
    const client = createPublicClient({
      chain: liskSepolia,
      transport: http('https://rpc.sepolia-api.lisk.com')
    });
    
    export default client;
    