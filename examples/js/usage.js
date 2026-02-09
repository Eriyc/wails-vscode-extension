// Example usage of Wails3 bindings with the extension

import { GetAllUsers, GetUserByID, CreateUser } from '../bindings/userservice';

/**
 * Load and display all users
 * 
 * TRY THIS:
 * - Ctrl+Click (Cmd+Click on Mac) on "GetAllUsers" 
 * - Instead of going to the JS bindings file, you'll be taken to the Go source!
 */
async function loadUsers() {
  try {
    const users = await GetAllUsers();
    console.log('All users:', users);
    return users;
  } catch (error) {
    console.error('Error loading users:', error);
  }
}

/**
 * Get a specific user by ID
 * 
 * TRY THIS:
 * - Ctrl+Click on "GetUserByID"
 * - Navigate directly to the Go function definition
 */
async function loadUser(userId) {
  try {
    const user = await GetUserByID(userId);
    console.log('User:', user);
    return user;
  } catch (error) {
    console.error('Error loading user:', error);
  }
}

/**
 * Create a new user
 * 
 * TRY THIS:
 * - Ctrl+Click on "CreateUser"
 * - See the Go implementation directly
 */
async function addUser(name, email) {
  try {
    const newUser = await CreateUser(name, email);
    console.log('Created user:', newUser);
    return newUser;
  } catch (error) {
    console.error('Error creating user:', error);
  }
}

// Usage examples
loadUsers();
loadUser(1);
addUser('Alice', 'alice@example.com');
