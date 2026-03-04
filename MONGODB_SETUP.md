# How to Create a MongoDB Cluster and Get Your Connection String

To get your MongoDB connection working, follow these steps to create a free cluster on MongoDB Atlas:

### 1. Create an Account
1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) and sign up for a free account.

### 2. Build a Cluster
1. Once logged in, click **"Create"** under the "Deploy a cloud database" section.
2. Select the **"M0 Free"** tier.
3. Choose your preferred cloud provider (e.g., AWS) and region.
4. Click **"Create Deployment"**.

### 3. Set Up Security
1. **Database User**: Create a username and a strong password. **Save these!**
2. **IP Access List**: Click "Add My Current IP Address" or, for development purposes, add `0.0.0.0/0` to allow access from anywhere (including Replit).

### 4. Get the Connection String
1. Go to the **"Database"** tab in the sidebar.
2. Click the **"Connect"** button on your cluster.
3. Choose **"Drivers"**.
4. Select **Node.js** as your driver.
5. Copy the connection string. it should look like:
   `mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`

### 5. Update Your Replit Secrets
1. In your Replit project, find the **Secrets** tool (the padlock icon in the sidebar).
2. Edit the `MONGODB_URI` secret.
3. Paste your new connection string, replacing `<password>` with the actual password you created in Step 3.
4. Restart your application.
